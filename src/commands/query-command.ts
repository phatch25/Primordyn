import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { ContextRetriever } from '../retriever/index.js';
import chalk from 'chalk';

export const queryCommand = new Command('query')
  .description('Search for relevant code context')
  .argument('<search-term>', 'Term to search for')
  .option('-t, --max-tokens <tokens>', 'Maximum tokens in response', '4000')
  .option('-c, --include-content', 'Include full file contents')
  .option('-s, --include-symbols', 'Include symbol definitions')
  .option('-i, --include-imports', 'Include import/export information')
  .option('--file-types <types>', 'Comma-separated list of file types to search')
  .option('--sort-by <field>', 'Sort by: relevance, path, size, modified', 'relevance')
  .option('--format <format>', 'Output format: json, markdown, text', 'text')
  .action(async (searchTerm: string, options) => {
    try {
      const db = new PrimordynDB();
      const retriever = new ContextRetriever(db);
      
      const fileTypes = options.fileTypes ? options.fileTypes.split(',').map((t: string) => t.trim()) : undefined;
      
      const result = await retriever.query(searchTerm, {
        maxTokens: parseInt(options.maxTokens),
        includeContent: options.includeContent,
        includeSymbols: options.includeSymbols,
        includeImports: options.includeImports,
        fileTypes,
        sortBy: options.sortBy
      });
      
      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        db.close();
        return;
      }
      
      // Text/Markdown output
      console.log(chalk.blue('🔍 Search Results for:'), chalk.cyan(`"${searchTerm}"`));
      console.log(chalk.gray('━'.repeat(60)));
      
      if (result.files.length === 0 && result.symbols.length === 0) {
        console.log(chalk.yellow('No results found. Try:'));
        console.log('  • Different search terms');
        console.log('  • Broader query');
        console.log('  • Check if files are indexed with:', chalk.cyan('primordyn stats'));
        db.close();
        return;
      }
      
      // Display files
      if (result.files.length > 0) {
        console.log(chalk.green('\n📁 Files:'));
        result.files.forEach((file, index) => {
          console.log(chalk.blue(`\n${index + 1}. ${file.relativePath}`));
          console.log(chalk.gray(`   Language: ${file.language || 'unknown'} | Tokens: ${file.tokens}`));
          
          if (file.preview && !options.includeContent) {
            console.log(chalk.gray('   Preview:'));
            const lines = file.preview.split('\n').slice(0, 3);
            lines.forEach(line => console.log(chalk.gray(`   ${line.substring(0, 80)}${line.length > 80 ? '...' : ''}`)));
            if (file.preview.split('\n').length > 3) {
              console.log(chalk.gray('   ...'));
            }
          }
          
          if (file.content && options.includeContent) {
            console.log(chalk.gray('   Content:'));
            const lines = file.content.split('\n').slice(0, 20);
            lines.forEach((line, i) => console.log(chalk.gray(`   ${(i + 1).toString().padStart(3)}: ${line}`)));
            if (file.content.split('\n').length > 20) {
              console.log(chalk.gray('   ... (truncated)'));
            }
          }
        });
      }
      
      // Display symbols
      if (result.symbols.length > 0) {
        console.log(chalk.green('\n🏷️  Symbols:'));
        result.symbols.forEach((symbol, index) => {
          console.log(chalk.blue(`\n${index + 1}. ${symbol.name}`));
          console.log(chalk.gray(`   Type: ${symbol.type} | File: ${symbol.filePath}:${symbol.lineStart}`));
          
          if (symbol.signature) {
            console.log(chalk.gray(`   Signature: ${symbol.signature}`));
          }
          
          if (symbol.content && options.includeSymbols) {
            console.log(chalk.gray('   Code:'));
            const lines = symbol.content.split('\n').slice(0, 10);
            lines.forEach(line => console.log(chalk.gray(`     ${line}`)));
            if (symbol.content.split('\n').length > 10) {
              console.log(chalk.gray('     ... (truncated)'));
            }
          }
        });
      }
      
      // Display summary
      console.log(chalk.gray('\n━'.repeat(60)));
      console.log(chalk.blue('📊 Summary:'));
      console.log(`  • Files found: ${chalk.yellow(result.files.length)}`);
      console.log(`  • Symbols found: ${chalk.yellow(result.symbols.length)}`);
      console.log(`  • Total tokens: ${chalk.yellow(result.totalTokens.toLocaleString())}`);
      
      if (result.truncated) {
        console.log(chalk.yellow('  ⚠️  Results truncated due to token limit'));
        console.log(`     Try increasing --max-tokens or refining your search`);
      }
      
      db.close();
      
    } catch (error) {
      console.error(chalk.red('❌ Query failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });