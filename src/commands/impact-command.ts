import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import chalk from 'chalk';
import ora from 'ora';
import { getHelpText } from '../utils/help-texts.js';

interface ImpactNode {
  symbol_name: string;
  file_path: string;
  relative_path: string;
  type: string;
  depth: number;
  reference_count: number;
  line_start: number;
}

export const impactCommand =
  new Command('impact')
    .description('Analyze the impact of changing a symbol')
    .argument('<symbol>', 'Symbol name to analyze')
    .option('-d, --depth <number>', 'Maximum depth to traverse (default: 3)', parseInt, 3)
    .option('--show-path', 'Show the dependency path for each affected symbol')
    .option('--suggest-order', 'Suggest migration order based on risk')
    .option('--format <type>', 'Output format: text, json, tree (default: text)', 'text')
    .addHelpText('after', getHelpText('impact'))
    .action(async (symbolName: string, options) => {
      const spinner = ora('Analyzing change impact...').start();
      
      try {
        const db = new PrimordynDB();
        // const projectRoot = process.cwd();
        // const dbPath = join(projectRoot, '.primordyn', 'context.db');
        
        const dbInfo = await db.getDatabaseInfo();
        if (dbInfo.fileCount === 0) {
          spinner.fail(chalk.red('No index found. Run "primordyn index" first.'));
          process.exit(1);
        }
        
        // Find the target symbol
        const targetStmt = db.getDatabase().prepare(`
          SELECT s.*, f.relative_path, f.path as file_path 
          FROM symbols s
          JOIN files f ON s.file_id = f.id
          WHERE s.name = ?
          LIMIT 1
        `);
        const targetSymbol = targetStmt.get(symbolName) as any;
        
        if (!targetSymbol) {
          spinner.fail(chalk.red(`Symbol "${symbolName}" not found`));
          db.close();
          process.exit(1);
        }
        
        // BFS to find all affected symbols up to max depth
        const visited = new Set<string>();
        const queue: ImpactNode[] = [];
        const impactMap = new Map<number, ImpactNode[]>();
        
        // Get direct references (depth 1)
        const directRefsStmt = db.getDatabase().prepare(`
          SELECT 
            s.name as symbol_name,
            f.path as file_path,
            s.type,
            s.line_start,
            f.relative_path,
            COUNT(*) as reference_count
          FROM call_graph cg
          JOIN symbols s ON cg.caller_symbol_id = s.id
          JOIN files f ON s.file_id = f.id
          WHERE cg.callee_symbol_id = (
            SELECT id FROM symbols WHERE name = ? LIMIT 1
          )
          GROUP BY s.id
        `);
        
        const directRefs = directRefsStmt.all(symbolName) as ImpactNode[];
        directRefs.forEach(ref => {
          ref.depth = 1;
          queue.push(ref);
          visited.add(`${ref.file_path}:${ref.symbol_name}`);
          if (!impactMap.has(1)) impactMap.set(1, []);
          impactMap.get(1)!.push(ref);
        });
        
        // BFS for deeper impacts
        while (queue.length > 0 && queue[0].depth < options.depth) {
          const current = queue.shift()!;
          
          const nextRefsStmt = db.getDatabase().prepare(`
            SELECT 
              s.name as symbol_name,
              f.path as file_path,
              s.type,
              s.line_start,
              f.relative_path,
              COUNT(*) as reference_count
            FROM call_graph cg
            JOIN symbols s ON cg.caller_symbol_id = s.id
            JOIN files f ON s.file_id = f.id
            WHERE cg.callee_symbol_id = (
              SELECT s.id FROM symbols s 
              JOIN files f ON s.file_id = f.id
              WHERE s.name = ? AND f.path = ? 
              LIMIT 1
            )
            GROUP BY s.id
          `);
          
          const nextRefs = nextRefsStmt.all(current.symbol_name, current.file_path) as ImpactNode[];
          
          nextRefs.forEach(ref => {
            const key = `${ref.file_path}:${ref.symbol_name}`;
            if (!visited.has(key)) {
              ref.depth = current.depth + 1;
              queue.push(ref);
              visited.add(key);
              if (!impactMap.has(ref.depth)) impactMap.set(ref.depth, []);
              impactMap.get(ref.depth)!.push(ref);
            }
          });
        }
        
        spinner.stop();
        
        // Calculate statistics
        const totalImpacted = Array.from(impactMap.values()).flat().length;
        const impactedFiles = new Set(Array.from(impactMap.values()).flat().map(n => n.file_path)).size;
        
        if (options.format === 'json') {
          console.log(JSON.stringify({
            target: symbolName,
            totalImpacted,
            impactedFiles,
            impacts: Object.fromEntries(impactMap)
          }, null, 2));
          db.close();
          return;
        }
        
        // Display results
        console.log(chalk.yellow(`\n🎯 Change Impact Analysis: ${chalk.white(symbolName)}\n`));
        console.log(chalk.gray(`Target: ${targetSymbol.type} ${symbolName} in ${targetSymbol.relative_path}:${targetSymbol.line_start}\n`));
        
        if (totalImpacted === 0) {
          console.log(chalk.green('✨ No dependencies found. This symbol can be safely modified.'));
          db.close();
          return;
        }
        
        // Risk assessment
        console.log(chalk.cyan('📊 RISK ASSESSMENT:'));
        
        const risks: Array<{symbol: ImpactNode, risk: string, score: number}> = [];
        
        for (const [depth, nodes] of impactMap) {
          for (const node of nodes) {
            const riskScore = (4 - depth) * node.reference_count;
            let risk = 'Low';
            if (riskScore > 10) risk = 'High';
            else if (riskScore > 5) risk = 'Medium';
            
            risks.push({ symbol: node, risk, score: riskScore });
          }
        }
        
        // Sort by risk score
        risks.sort((a, b) => b.score - a.score);
        
        // Group by risk level
        const highRisk = risks.filter(r => r.risk === 'High');
        const mediumRisk = risks.filter(r => r.risk === 'Medium');
        const lowRisk = risks.filter(r => r.risk === 'Low');
        
        if (highRisk.length > 0) {
          console.log(chalk.red('\n  High Risk:'));
          highRisk.slice(0, 5).forEach(r => {
            console.log(`    ${chalk.red('●')} ${r.symbol.relative_path}:${r.symbol.line_start} - ${r.symbol.type} ${r.symbol.symbol_name} (${r.symbol.reference_count} refs, depth ${r.symbol.depth})`);
          });
        }
        
        if (mediumRisk.length > 0) {
          console.log(chalk.yellow('\n  Medium Risk:'));
          mediumRisk.slice(0, 5).forEach(r => {
            console.log(`    ${chalk.yellow('●')} ${r.symbol.relative_path}:${r.symbol.line_start} - ${r.symbol.type} ${r.symbol.symbol_name} (${r.symbol.reference_count} refs, depth ${r.symbol.depth})`);
          });
        }
        
        if (lowRisk.length > 0) {
          console.log(chalk.green('\n  Low Risk:'));
          lowRisk.slice(0, 5).forEach(r => {
            console.log(`    ${chalk.green('●')} ${r.symbol.relative_path}:${r.symbol.line_start} - ${r.symbol.type} ${r.symbol.symbol_name} (${r.symbol.reference_count} refs, depth ${r.symbol.depth})`);
          });
        }
        
        if (options.suggestOrder) {
          console.log(chalk.cyan('\n🔄 SUGGESTED MIGRATION ORDER:'));
          
          // Reverse the risk order for migration (start with lowest risk)
          const migrationOrder = [...risks].reverse();
          
          migrationOrder.slice(0, 10).forEach((r, index) => {
            const riskColor = r.risk === 'High' ? chalk.red : r.risk === 'Medium' ? chalk.yellow : chalk.green;
            console.log(`  ${index + 1}. ${r.symbol.relative_path} - ${r.symbol.symbol_name} ${riskColor(`[${r.risk}]`)}`);
          });
          
          console.log(chalk.gray('\n  💡 Start with low-risk changes and work up to high-risk ones'));
        }
        
        // Summary
        console.log(chalk.yellow('\n📈 IMPACT SUMMARY:'));
        console.log(`  • ${chalk.white(totalImpacted)} symbols affected`);
        console.log(`  • ${chalk.white(impactedFiles)} files impacted`);
        console.log(`  • ${chalk.red(highRisk.length)} high risk, ${chalk.yellow(mediumRisk.length)} medium risk, ${chalk.green(lowRisk.length)} low risk`);
        
        // Breaking change detection
        const breakingChangeStmt = db.getDatabase().prepare(`
          SELECT COUNT(DISTINCT caller_symbol_id) as callers
          FROM call_graph
          WHERE callee_symbol_id = (SELECT id FROM symbols WHERE name = ? LIMIT 1)
        `);
        const { callers } = breakingChangeStmt.get(symbolName) as any;
        
        console.log(chalk.cyan('\n⚡ BREAKING CHANGE DETECTION:'));
        console.log(`  • Method signature changes would affect ${chalk.white(callers)} direct callers`);
        console.log(`  • Adding optional parameters: ${chalk.green('safe')} for all callers`);
        console.log(`  • Removing/renaming: ${chalk.red('breaking')} for ${callers} callers`);
        
        db.close();
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        process.exit(1);
      }
    });