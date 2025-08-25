import { Command } from 'commander';
import { DatabaseConnectionPool } from '../database/connection-pool.js';
import { ContextRetriever } from '../retriever/index.js';
import { validateSearchTerm, ValidationError } from '../utils/validation.js';
import chalk from 'chalk';

export const queryCommand = new Command('query')
  .description('Find where symbols are defined and used')
  .argument('<target>', 'Symbol name or file path to locate')
  .option('--format <type>', 'Output format: text, json (default: text)', 'text')
  .option('--show-graph', 'Show what it calls and what calls it')
  .option('--impact', 'Show files affected by changes')
  .option('--type <symbol-type>', 'Filter by symbol type: function,class,interface,method,etc')
  .addHelpText('after', `
${chalk.bold('Purpose:')}
  Navigate to symbol definitions and understand code relationships without
  pulling full implementations. Designed for AI assistants to quickly locate
  and understand code structure.

${chalk.bold('Examples:')}
  ${chalk.gray('# Find where a symbol is defined')}
  $ primordyn query UserService
  ${chalk.gray('→ Shows: src/services/UserService.ts:15')}
  
  ${chalk.gray('# Show what calls it and what it calls')}
  $ primordyn query processData --show-graph
  ${chalk.gray('→ Shows call hierarchy in both directions')}
  
  ${chalk.gray('# See what breaks if you change something')}
  $ primordyn query AuthService --impact
  ${chalk.gray('→ Lists all files that reference this symbol')}
  
  ${chalk.gray('# Get machine-readable output')}
  $ primordyn query Database --format json
  
  ${chalk.gray('# Find specific symbol types')}
  $ primordyn query render --type function

${chalk.bold('What it shows:')}
  • Exact file:line location of definitions
  • Direct callers and callees (--show-graph)
  • All files referencing the symbol (--impact)
  • No code dumps, just navigation info

${chalk.bold('Tips:')}
  • Use exact symbol names for best results
  • Combine with 'list' command for discovery
  • Use --impact before refactoring`)
  .action(async (searchTerm: string, options: any) => {
    try {
      const validatedSearchTerm = validateSearchTerm(searchTerm);
      const format = options.format || 'text';
      const symbolType = options.type;
      
      const db = DatabaseConnectionPool.getConnection();
      
      // Check if index exists, build only if empty
      const dbInfo = await db.getDatabaseInfo();
      const isFirstIndex = dbInfo.fileCount === 0;
      
      if (isFirstIndex) {
        // First time - must build index
        const { Indexer } = await import('../indexer/index.js');
        const indexer = new Indexer(db);
        
        const spinner = (await import('ora')).default('Building index for the first time...').start();
        
        try {
          const stats = await indexer.index({ verbose: false, updateExisting: true });
          spinner.succeed(
            `Index built: ${stats.filesIndexed} files, ${stats.symbolsExtracted} symbols (${(stats.timeElapsed / 1000).toFixed(2)}s)`
          );
        } catch (error) {
          spinner.fail('Failed to build index');
          throw error;
        }
      }
      
      const retriever = new ContextRetriever(db);
      
      // Find exact symbol matches
      const symbols = await retriever.findSymbol(validatedSearchTerm, { symbolType });
      
      // Get dependency graph if requested
      let dependencyGraph: any = null;
      if (options.showGraph && symbols.length > 0) {
        dependencyGraph = await retriever.getDependencyGraphWithDepth(validatedSearchTerm, 1);
      }
      
      // Get impact analysis if requested
      let impactAnalysis: any = null;
      if (options.impact && symbols.length > 0) {
        impactAnalysis = await retriever.getImpactAnalysis(validatedSearchTerm);
      }
      
      // Simple result structure
      const result = {
        symbols,
        dependencyGraph,
        impactAnalysis
      };
      
      // Handle different output formats
      if (format === 'json') {
        // Transform symbols to navigation-focused format (remove verbose content)
        const navigationResult = {
          symbols: result.symbols.map((symbol: any) => ({
            id: symbol.id,
            name: symbol.name,
            type: symbol.type,
            filePath: symbol.filePath,
            lineStart: symbol.lineStart,
            lineEnd: symbol.lineEnd,
            signature: symbol.signature
            // Exclude content field for navigation focus
          })),
          dependencyGraph: result.dependencyGraph,
          impactAnalysis: result.impactAnalysis
        };
        console.log(JSON.stringify(navigationResult, null, 2));
      } else {
        outputNavigationFormat(validatedSearchTerm, result, options);
      }
      
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(chalk.red('❌ Validation error:'), error.message);
      } else {
        console.error(chalk.red('❌ Query failed:'), error instanceof Error ? error.message : error);
      }
      process.exit(1);
    }
  });

function outputNavigationFormat(searchTerm: string, result: any, options: any) {
  if (!result.symbols || result.symbols.length === 0) {
    console.log(chalk.yellow(`No exact match for "${searchTerm}"`));
    console.log(chalk.gray(`Try: primordyn list "${searchTerm}"`));
    return;
  }
  
  // Primary symbol location
  const primary = result.symbols[0];
  console.log(chalk.green(`Found: ${primary.name} (${primary.type})`));
  console.log(chalk.blue(`📍 ${primary.filePath}:${primary.lineStart}`));
  
  if (primary.signature) {
    console.log(chalk.gray(`Signature: ${primary.signature}`));
  }
  
  // Additional locations if multiple definitions of the SAME type
  const sameTypeSymbols = result.symbols.filter((s: any) => s.type === primary.type);
  if (sameTypeSymbols.length > 1) {
    console.log(chalk.gray(`\nAlso defined in:`));
    sameTypeSymbols.slice(1).forEach((s: any) => {
      console.log(chalk.gray(`  • ${s.filePath}:${s.lineStart}`));
    });
  }
  
  // Show graph if requested
  if (options.showGraph && result.dependencyGraph) {
    const graph = result.dependencyGraph;
    
    if (graph.calls && graph.calls.length > 0) {
      console.log(chalk.cyan(`\nCalls (${graph.calls.length}):`));
      graph.calls.slice(0, 10).forEach((c: any) => {
        console.log(`  → ${c.to.name} at ${c.to.filePath}:${c.to.line}`);
      });
      if (graph.calls.length > 10) {
        console.log(chalk.gray(`  ... and ${graph.calls.length - 10} more`));
      }
    }
    
    if (graph.calledBy && graph.calledBy.length > 0) {
      // Filter out anonymous entries and provide better names
      const namedCallers = graph.calledBy.map((c: any) => {
        if (c.from.name === 'anonymous' || !c.from.name) {
          // Extract function name from file or use file name
          const fileName = c.from.filePath.split('/').pop()?.replace('.ts', '').replace('.js', '') || 'unknown';
          return {
            ...c,
            from: {
              ...c.from,
              name: `${fileName} file`
            }
          };
        }
        return c;
      });

      // Deduplicate by file:line combination
      const uniqueCallers = namedCallers.filter((c: any, index: number, array: any[]) => {
        const key = `${c.from.filePath}:${c.from.line}`;
        return array.findIndex((other: any) => `${other.from.filePath}:${other.from.line}` === key) === index;
      });

      console.log(chalk.cyan(`\nCalled by (${uniqueCallers.length}):`));
      uniqueCallers.slice(0, 10).forEach((c: any) => {
        console.log(`  ← ${c.from.name} at ${c.from.filePath}:${c.from.line}`);
      });
      if (uniqueCallers.length > 10) {
        console.log(chalk.gray(`  ... and ${uniqueCallers.length - 10} more`));
      }
    }
  }
  
  // Show impact if requested
  if (options.impact && result.impactAnalysis) {
    const impact = result.impactAnalysis;
    console.log(chalk.yellow(`\nImpact: ${impact.filesAffected} files, ${impact.directReferences} references`));
    
    if (impact.affectedFiles && impact.affectedFiles.length > 0) {
      console.log(chalk.gray(`Affected files:`));
      impact.affectedFiles.slice(0, 10).forEach((file: any) => {
        const lines = file.lines ? file.lines.slice(0, 5).join(', ') : '';
        const more = file.lines && file.lines.length > 5 ? ` ... +${file.lines.length - 5}` : '';
        console.log(`  • ${file.path} (lines: ${lines}${more})`);
      });
      if (impact.affectedFiles.length > 10) {
        console.log(chalk.gray(`  ... and ${impact.affectedFiles.length - 10} more files`));
      }
    }
  }
  
  // Suggest next steps
  console.log(chalk.gray(`\nNext steps:`));
  console.log(chalk.gray(`  • Open file: ${primary.filePath}:${primary.lineStart}`));
  if (!options.showGraph) {
    console.log(chalk.gray(`  • primordyn query "${searchTerm}" --show-graph`));
  }
  if (!options.impact) {
    console.log(chalk.gray(`  • primordyn query "${searchTerm}" --impact`));
  }
}