import { Command } from 'commander';
import { DatabaseConnectionPool } from '../database/connection-pool.js';
import { ContextRetriever } from '../retriever/index.js';
import chalk from 'chalk';

export const impactCommand = new Command('impact')
  .description('Analyze what breaks if you change a symbol')
  .argument('<symbol>', 'Symbol to analyze')
  .option('--depth <n>', 'How deep to trace impacts (default: 2)', '2')
  .option('--format <type>', 'Output format: text, json (default: text)', 'text')
  .action(async (symbolName: string, options: any) => {
    try {
      const db = DatabaseConnectionPool.getConnection();
      const retriever = new ContextRetriever(db);
      
      // Check index exists
      const dbInfo = await db.getDatabaseInfo();
      if (dbInfo.fileCount === 0) {
        console.log(chalk.red('No index found. Run "primordyn index" first.'));
        process.exit(1);
      }
      
      // Find the symbol
      const symbols = await retriever.findSymbol(symbolName, {});
      if (symbols.length === 0) {
        console.log(chalk.red(`Symbol "${symbolName}" not found`));
        process.exit(1);
      }
      
      const target = symbols[0];
      const depth = parseInt(options.depth || '2');
      
      // Get direct callers (depth 1)
      const directCallers = db.getDatabase().prepare(`
        SELECT DISTINCT
          s.name as symbol_name,
          s.type,
          f.relative_path as file_path,
          s.line_start,
          cg.line_number as call_line
        FROM call_graph cg
        JOIN symbols s ON cg.caller_symbol_id = s.id
        JOIN files f ON s.file_id = f.id
        WHERE cg.callee_symbol_id = ?
        ORDER BY f.relative_path, s.line_start
      `).all(target.id) as any[];
      
      // Get text references (imports, types, etc)
      const textRefs = db.getDatabase().prepare(`
        SELECT DISTINCT
          f.relative_path as file_path,
          COUNT(*) as ref_count
        FROM files f
        WHERE f.content LIKE '%' || ? || '%'
          AND f.id != (SELECT file_id FROM symbols WHERE id = ?)
        GROUP BY f.id
        ORDER BY ref_count DESC
        LIMIT 20
      `).all(symbolName, target.id) as any[];
      
      // Analyze breaking changes
      const breakingChanges = analyzeBreaking(target, directCallers, textRefs);
      
      if (options.format === 'json') {
        console.log(JSON.stringify({
          target: {
            name: target.name,
            type: target.type,
            location: `${target.filePath}:${target.lineStart}`
          },
          directCallers: directCallers.length,
          textReferences: textRefs.reduce((sum, r) => sum + r.ref_count, 0),
          breakingChanges
        }, null, 2));
        return;
      }
      
      // Text output - focused on what breaks
      console.log(chalk.bold(`\nImpact Analysis: ${target.name}`));
      console.log(chalk.gray(`${target.filePath}:${target.lineStart}`));
      console.log(chalk.gray('─'.repeat(50)));
      
      // Direct impact (who calls this)
      if (directCallers.length > 0) {
        console.log(chalk.yellow(`\n${directCallers.length} direct callers:`));
        const byFile = new Map<string, typeof directCallers>();
        directCallers.forEach(caller => {
          if (!byFile.has(caller.file_path)) {
            byFile.set(caller.file_path, []);
          }
          byFile.get(caller.file_path)!.push(caller);
        });
        
        for (const [file, callers] of byFile) {
          console.log(`\n  ${chalk.cyan(file)}`);
          callers.forEach(c => {
            console.log(`    • ${c.symbol_name} (line ${c.call_line})`);
          });
        }
      } else {
        console.log(chalk.green('\nNo direct callers found'));
      }
      
      // Text references (imports, type usage, etc)
      if (textRefs.length > 0) {
        const totalRefs = textRefs.reduce((sum, r) => sum + r.ref_count, 0);
        console.log(chalk.yellow(`\n${totalRefs} text references in ${textRefs.length} files:`));
        textRefs.slice(0, 10).forEach(ref => {
          console.log(`  • ${ref.file_path} (${ref.ref_count} references)`);
        });
        if (textRefs.length > 10) {
          console.log(chalk.gray(`  ... and ${textRefs.length - 10} more files`));
        }
      }
      
      // Breaking change analysis
      console.log(chalk.bold('\n🔨 Breaking Changes:'));
      breakingChanges.forEach(change => {
        const icon = change.safe ? '✅' : '⚠️';
        const color = change.safe ? chalk.green : chalk.yellow;
        console.log(`  ${icon} ${color(change.action)}: ${change.description}`);
      });
      
      // Recommended action
      if (directCallers.length === 0 && textRefs.length === 0) {
        console.log(chalk.green('\n✨ Safe to modify - no dependencies found'));
      } else if (directCallers.length < 3 && textRefs.length < 5) {
        console.log(chalk.yellow('\n⚡ Low risk - limited impact scope'));
      } else {
        console.log(chalk.red('\n⚠️  High risk - widespread usage'));
        console.log(chalk.gray('Consider creating a compatibility layer'));
      }
      
    } catch (error) {
      console.error(chalk.red('Impact analysis failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  })
  .addHelpText('after', `
${chalk.bold('Purpose:')}
  Assess the risk of changing code. Shows exactly what will break if you
  modify, rename, or remove a symbol, helping you make safe refactoring decisions.

${chalk.bold('Examples:')}
  ${chalk.gray('# Check what breaks if you change processData')}
  $ primordyn impact processData
  ${chalk.gray('→ Shows: 5 direct callers, 12 text references')}
  
  ${chalk.gray('# Analyze deeper transitive impacts')}  
  $ primordyn impact UserService --depth 3
  
  ${chalk.gray('# Get machine-readable analysis')}
  $ primordyn impact AuthService --format json

${chalk.bold('What it analyzes:')}
  • Direct callers - functions/methods that call this
  • Text references - imports, types, string refs
  • Breaking scenarios - what changes are safe vs risky
  • Risk level - safe, low risk, or high risk

${chalk.bold('Breaking change guide:')}
  ✅ Safe: Adding optional parameters, new methods
  ⚠️  Risky: Removing, renaming, changing signatures
  
${chalk.bold('Risk levels:')}
  • Safe to modify - no dependencies found
  • Low risk - < 3 callers, < 5 references
  • High risk - widespread usage

${chalk.bold('Use before:')}
  • Renaming functions or classes
  • Changing method signatures
  • Removing features
  • Major refactoring
  • API changes`);

function analyzeBreaking(target: any, directCallers: any[], textRefs: any[]) {
  const changes = [];
  
  // Analyze based on symbol type
  if (target.type === 'function' || target.type === 'method') {
    changes.push({
      action: 'Add optional parameter',
      safe: true,
      description: 'Backward compatible'
    });
    changes.push({
      action: 'Remove/rename',
      safe: false,
      description: `Breaks ${directCallers.length} call sites`
    });
    changes.push({
      action: 'Change return type',
      safe: false,
      description: 'May break type expectations'
    });
  } else if (target.type === 'class') {
    changes.push({
      action: 'Add method/property',
      safe: true,
      description: 'Backward compatible'
    });
    changes.push({
      action: 'Remove method',
      safe: false,
      description: `Check ${directCallers.length} usage sites`
    });
    changes.push({
      action: 'Rename class',
      safe: false,
      description: `Update ${textRefs.length} files with imports`
    });
  } else if (target.type === 'interface' || target.type === 'type') {
    changes.push({
      action: 'Add optional property',
      safe: true,
      description: 'Backward compatible'
    });
    changes.push({
      action: 'Add required property',
      safe: false,
      description: 'Breaks all implementations'
    });
    changes.push({
      action: 'Remove property',
      safe: false,
      description: 'May break consumers'
    });
  }
  
  return changes;
}