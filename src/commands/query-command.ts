import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { ContextRetriever } from '../retriever/index.js';
import chalk from 'chalk';

export const queryCommand = new Command('query')
  .description('Get relevant code context for AI agents')
  .argument('<search-term>', 'Search query or file path for related files')
  .option('--tokens <max>', 'Maximum tokens in response (default: 8000)', '8000')
  .option('--related <file>', 'Find files related to specified file path')
  .option('--symbols', 'Include symbol definitions and signatures')
  .option('--content', 'Include full file contents (uses more tokens)')
  .option('--languages <langs>', 'Filter by languages: ts,js,py,go,etc')
  .option('--json', 'Output structured JSON for AI consumption')
  .action(async (searchTerm: string, options) => {
    try {
      const db = new PrimordynDB();
      const retriever = new ContextRetriever(db);
      
      const fileTypes = options.languages ? options.languages.split(',').map((t: string) => t.trim()) : undefined;
      const maxTokens = parseInt(options.tokens);
      
      let result;
      
      // Handle related files query
      if (options.related) {
        const relatedFiles = await retriever.getRelatedFiles(options.related, {
          maxTokens,
          includeContent: options.content,
          includeSymbols: options.symbols,
          includeImports: true,
          fileTypes
        });
        
        result = {
          files: relatedFiles,
          symbols: [],
          totalTokens: relatedFiles.reduce((sum, f) => sum + f.tokens, 0),
          truncated: false,
          query_type: 'related',
          source_file: options.related
        };
      } else {
        // Regular search query
        result = await retriever.query(searchTerm, {
          maxTokens,
          includeContent: options.content,
          includeSymbols: options.symbols,
          includeImports: true,
          fileTypes,
          sortBy: 'relevance'
        });
        result.query_type = 'search';
      }
      
      // JSON output for AI agents
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        db.close();
        return;
      }
      
      // Human-readable output
      const isRelated = options.related;
      const title = isRelated 
        ? `🔗 Files related to: ${chalk.cyan(options.related)}`
        : `🔍 Context for: ${chalk.cyan(`"${searchTerm}"`)}`;
      
      console.log(title);
      console.log(chalk.gray('━'.repeat(60)));
      
      if (result.files.length === 0 && result.symbols.length === 0) {
        console.log(chalk.yellow('No results found.'));
        console.log('\n' + chalk.blue('💡 Try:'));
        console.log('  • Different search terms');
        console.log('  • Add --content for full file contents');
        console.log('  • Check indexed files:', chalk.cyan('primordyn stats'));
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