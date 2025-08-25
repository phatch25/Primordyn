import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import chalk from 'chalk';
import ora from 'ora';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CircularChain {
  symbols: Array<{
    name: string;
    file: string;
    type: string;
  }>;
  strength: number; // Number of edges in the cycle
}

export const circularCommand =
  new Command('circular')
    .description('Detect circular dependencies in the codebase')
    .option('--max-depth <number>', 'Maximum depth to search for cycles (default: 10)', parseInt, 10)
    .option('--show-all', 'Show all circular dependencies (not just unique cycles)')
    .option('--by-file', 'Group circular dependencies by file instead of by symbol')
    .action(async (options) => {
      const spinner = ora('Detecting circular dependencies...').start();
      
      try {
        const db = new PrimordynDB();
        const projectRoot = process.cwd();
        const dbPath = join(projectRoot, '.primordyn', 'context.db');
        
        const dbInfo = await db.getDatabaseInfo();
        if (dbInfo.fileCount === 0) {
          spinner.fail(chalk.red('No index found. Run "primordyn index" first.'));
          process.exit(1);
        }
        
        // Build adjacency list for cycle detection
        const adjacencyList = new Map<string, Set<string>>();
        const symbolInfo = new Map<string, { type: string, file: string }>();
        
        // Get all edges from call graph
        const edgesStmt = db.getDatabase().prepare(`
          SELECT 
            s1.name as source_name,
            f1.path as source_file,
            s1.type as source_type,
            s2.name as target_name,
            f2.path as target_file,
            s2.type as target_type,
            f1.relative_path as source_relative,
            f2.relative_path as target_relative
          FROM call_graph cg
          JOIN symbols s1 ON cg.caller_symbol_id = s1.id
          JOIN symbols s2 ON cg.callee_symbol_id = s2.id
          JOIN files f1 ON s1.file_id = f1.id
          JOIN files f2 ON s2.file_id = f2.id
          WHERE s2.id IS NOT NULL
        `);
        
        const edges = edgesStmt.all() as any[];
        
        // Build graph
        for (const edge of edges as any[]) {
          const sourceKey = `${edge.source_file}:${edge.source_name}`;
          const targetKey = `${edge.target_file}:${edge.target_name}`;
          
          // Skip self-references (recursion)
          if (sourceKey === targetKey) continue;
          
          if (!adjacencyList.has(sourceKey)) {
            adjacencyList.set(sourceKey, new Set());
          }
          adjacencyList.get(sourceKey)!.add(targetKey);
          
          // Store symbol info
          symbolInfo.set(sourceKey, { 
            type: edge.source_type, 
            file: edge.source_relative 
          });
          symbolInfo.set(targetKey, { 
            type: edge.target_type, 
            file: edge.target_relative 
          });
        }
        
        // Detect cycles using DFS
        const cycles: CircularChain[] = [];
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const currentPath: string[] = [];
        
        function detectCyclesDFS(node: string, depth: number = 0) {
          if (depth > options.maxDepth) return;
          
          visited.add(node);
          recursionStack.add(node);
          currentPath.push(node);
          
          const neighbors = adjacencyList.get(node) || new Set();
          
          for (const neighbor of neighbors) {
            if (recursionStack.has(neighbor)) {
              // Found a cycle
              const cycleStart = currentPath.indexOf(neighbor);
              const cycle = currentPath.slice(cycleStart);
              cycle.push(neighbor); // Complete the cycle
              
              // Create cycle info
              const chain: CircularChain = {
                symbols: cycle.map(key => {
                  const [file, name] = key.split(':');
                  const info = symbolInfo.get(key) || { type: 'unknown', file: 'unknown' };
                  return { name, file: info.file, type: info.type };
                }),
                strength: cycle.length - 1
              };
              
              // Check if this cycle is already recorded (in different order)
              const cycleSignature = [...cycle].sort().join('->');
              const isDuplicate = cycles.some(c => {
                const sig = c.symbols.map(s => `${s.file}:${s.name}`).sort().join('->');
                return sig === cycleSignature;
              });
              
              if (!isDuplicate || options.showAll) {
                cycles.push(chain);
              }
            } else if (!visited.has(neighbor)) {
              detectCyclesDFS(neighbor, depth + 1);
            }
          }
          
          currentPath.pop();
          recursionStack.delete(node);
        }
        
        // Run DFS from each unvisited node
        for (const node of adjacencyList.keys()) {
          if (!visited.has(node)) {
            detectCyclesDFS(node);
          }
        }
        
        spinner.stop();
        
        if (cycles.length === 0) {
          console.log(chalk.green('✨ No circular dependencies detected!'));
          db.close();
          return;
        }
        
        // Sort cycles by strength (smaller cycles are usually worse)
        cycles.sort((a, b) => a.strength - b.strength);
        
        console.log(chalk.red(`\n⚠️  Found ${cycles.length} circular dependencies:\n`));
        
        // Group by file if requested
        if (options.byFile) {
          const byFile = new Map<string, CircularChain[]>();
          
          for (const cycle of cycles) {
            const files = new Set(cycle.symbols.map(s => s.file));
            for (const file of files) {
              if (!byFile.has(file)) {
                byFile.set(file, []);
              }
              byFile.get(file)!.push(cycle);
            }
          }
          
          for (const [file, fileCycles] of byFile) {
            console.log(chalk.cyan(`\n${file}:`));
            for (const cycle of fileCycles.slice(0, 5)) {
              renderCycle(cycle);
            }
          }
        } else {
          // Show top circular dependencies
          for (const cycle of cycles.slice(0, 15)) {
            renderCycle(cycle);
          }
        }
        
        // Statistics
        const affectedFiles = new Set(cycles.flatMap(c => c.symbols.map(s => s.file))).size;
        const avgCycleLength = cycles.reduce((sum, c) => sum + c.strength, 0) / cycles.length;
        
        console.log(chalk.yellow('\n📊 CIRCULAR DEPENDENCY SUMMARY:'));
        console.log(`  • ${chalk.red(cycles.length)} circular dependencies found`);
        console.log(`  • ${chalk.white(affectedFiles)} files affected`);
        console.log(`  • ${chalk.white(avgCycleLength.toFixed(1))} average cycle length`);
        
        // Find the worst offenders
        const symbolCounts = new Map<string, number>();
        for (const cycle of cycles) {
          for (const symbol of cycle.symbols) {
            const key = `${symbol.file}:${symbol.name}`;
            symbolCounts.set(key, (symbolCounts.get(key) || 0) + 1);
          }
        }
        
        const topOffenders = Array.from(symbolCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        
        if (topOffenders.length > 0) {
          console.log(chalk.cyan('\n🎯 TOP CIRCULAR DEPENDENCY SOURCES:'));
          for (const [key, count] of topOffenders) {
            const [file, name] = key.split(':');
            const info = symbolInfo.get(key);
            console.log(`  ${chalk.red('●')} ${info?.file || file} - ${name} (${count} cycles)`);
          }
        }
        
        // Refactoring suggestions
        console.log(chalk.cyan('\n💡 REFACTORING SUGGESTIONS:'));
        
        const tightCycles = cycles.filter(c => c.strength <= 2);
        const crossFileCycles = cycles.filter(c => {
          const files = new Set(c.symbols.map(s => s.file));
          return files.size > 1;
        });
        
        if (tightCycles.length > 0) {
          console.log(`  • ${chalk.yellow(tightCycles.length)} tight cycles (2-3 symbols) - consider merging or using dependency injection`);
        }
        
        if (crossFileCycles.length > 0) {
          console.log(`  • ${chalk.yellow(crossFileCycles.length)} cross-file cycles - consider introducing abstraction layers`);
        }
        
        const hasLayerViolation = cycles.some(c => {
          const paths = c.symbols.map(s => s.file);
          return paths.some(p => p.includes('controller')) && paths.some(p => p.includes('service'));
        });
        
        if (hasLayerViolation) {
          console.log(`  • ${chalk.red('Layer violations detected')} - controllers depending on services that depend back`);
        }
        
        db.close();
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        process.exit(1);
      }
    });

function renderCycle(cycle: CircularChain) {
  console.log('');
  
  for (let i = 0; i < cycle.symbols.length; i++) {
    const symbol = cycle.symbols[i];
    const isLast = i === cycle.symbols.length - 1;
    const prefix = i === 0 ? '  ┌─>' : isLast ? '  └─>' : '  ├─>';
    
    const location = chalk.gray(`${symbol.file}`);
    console.log(`${prefix} ${symbol.type} ${chalk.white(symbol.name)} ${location}`);
  }
  
  console.log(chalk.yellow(`     Cycle strength: ${cycle.strength} dependencies`));
}