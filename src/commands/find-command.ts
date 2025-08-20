import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { ContextRetriever } from '../retriever/index.js';
import chalk from 'chalk';

export const findCommand = new Command('find')
  .description('Find specific symbols (functions, classes, etc.)')
  .argument('<symbol-name>', 'Name of the symbol to find')
  .option('--type <type>', 'Filter by symbol type (function, class, interface, etc.)')
  .option('-c, --include-content', 'Include symbol content')
  .option('-m, --max-results <num>', 'Maximum number of results', '20')
  .option('--file-types <types>', 'Comma-separated list of file types to search')
  .option('--format <format>', 'Output format: json, text', 'text')
  .action(async (symbolName: string, options) => {
    try {
      const db = new PrimordynDB();
      const retriever = new ContextRetriever(db);
      
      const fileTypes = options.fileTypes ? options.fileTypes.split(',').map((t: string) => t.trim()) : undefined;
      
      const symbols = await retriever.findSymbol(symbolName, {
        fileTypes,
        includeContent: options.includeContent
      });
      
      // Filter by type if specified
      const filteredSymbols = options.type 
        ? symbols.filter(s => s.type.toLowerCase() === options.type.toLowerCase())
        : symbols;
      
      // Limit results
      const maxResults = parseInt(options.maxResults);
      const results = filteredSymbols.slice(0, maxResults);
      
      if (options.format === 'json') {
        console.log(JSON.stringify(results, null, 2));
        db.close();
        return;
      }
      
      // Text output
      console.log(chalk.blue('🔍 Symbol Search:'), chalk.cyan(`"${symbolName}"`));
      if (options.type) {
        console.log(chalk.gray('   Type filter:'), chalk.cyan(options.type));
      }
      console.log(chalk.gray('━'.repeat(60)));
      
      if (results.length === 0) {
        console.log(chalk.yellow('No symbols found. Try:'));
        console.log('  • Different symbol name');
        console.log('  • Remove type filter');
        console.log('  • Check available symbols with:', chalk.cyan('primordyn stats'));
        db.close();
        return;
      }
      
      results.forEach((symbol, index) => {
        console.log(chalk.blue(`\n${index + 1}. ${symbol.name}`));
        console.log(chalk.gray(`   Type: ${chalk.cyan(symbol.type)}`));
        console.log(chalk.gray(`   Location: ${chalk.cyan(symbol.filePath)}:${symbol.lineStart}-${symbol.lineEnd}`));
        
        if (symbol.signature) {
          console.log(chalk.gray(`   Signature:`));
          console.log(chalk.gray(`     ${symbol.signature}`));
        }
        
        if (symbol.content && options.includeContent) {
          console.log(chalk.gray('   Code:'));
          const lines = symbol.content.split('\n');
          const maxLines = 15;
          const displayLines = lines.slice(0, maxLines);
          
          displayLines.forEach((line, i) => {
            const lineNum = symbol.lineStart + i;
            console.log(chalk.gray(`     ${lineNum.toString().padStart(3)}: ${line}`));
          });
          
          if (lines.length > maxLines) {
            console.log(chalk.gray(`     ... (${lines.length - maxLines} more lines)`));
          }
        }
      });
      
      // Summary
      console.log(chalk.gray('\n━'.repeat(60)));
      console.log(chalk.blue('📊 Summary:'));
      console.log(`  • Symbols found: ${chalk.yellow(results.length)}`);
      
      if (filteredSymbols.length > results.length) {
        console.log(`  • Total matches: ${chalk.yellow(filteredSymbols.length)} (showing first ${maxResults})`);
        console.log(chalk.gray('    Use --max-results to see more'));
      }
      
      if (results.length > 0 && !options.includeContent) {
        console.log(chalk.green('\n💡 Tip:'), 'Add', chalk.cyan('--include-content'), 'to see the actual code');
      }
      
      db.close();
      
    } catch (error) {
      console.error(chalk.red('❌ Search failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });