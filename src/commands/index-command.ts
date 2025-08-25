import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { Indexer } from '../indexer/index.js';
import chalk from 'chalk';

export const indexCommand = new Command('index')
  .description('Build or update the local context index for AI agents')
  .argument('[path]', 'Path to index (defaults to current directory)', '.')
  .option('--clear', 'Clear existing index before rebuilding')
  .option('--languages <langs>', 'Languages to index: ts,js,py,go,rs,java,rb,php,etc')
  .option('--max-size <kb>', 'Maximum file size in KB (default: 1024)', '1024')
  .option('--update', 'Update only changed files (incremental)')
  .option('--quiet', 'Minimal output')
  .addHelpText('after', `
${chalk.bold('Purpose:')}
  Build a searchable index of your codebase. Extracts symbols, relationships,
  and call graphs to help AI assistants navigate and understand your code.

${chalk.bold('Examples:')}
  ${chalk.gray('# Index current directory (first time)')}
  $ primordyn index
  ${chalk.gray('→ Indexes all supported files, builds symbol database')}

  ${chalk.gray('# Quick incremental update (after changes)')}
  $ primordyn index --update
  ${chalk.gray('→ Only re-indexes modified files')}

  ${chalk.gray('# Clear and rebuild from scratch')}
  $ primordyn index --clear

  ${chalk.gray('# Index only specific languages')}
  $ primordyn index --languages ts,js
  
  ${chalk.gray('# Index specific directory')}
  $ primordyn index ./src

${chalk.bold('Features:')}
  • Smart incremental updates (--update)
  • AST-based symbol extraction
  • Call graph tracking
  • Token counting for AI
  • Respects .gitignore

${chalk.bold('What gets indexed:')}
  • Functions, methods, classes
  • Interfaces, types, structs
  • API endpoints
  • Symbol relationships
  • Import/export chains

${chalk.bold('Performance tips:')}
  • Use --update for daily work (faster)
  • Use --clear when switching branches
  • Adjust --max-size for large files
  • Use --languages to focus indexing

${chalk.bold('Supported languages:')}
  TypeScript, JavaScript, Python, Go, Rust, Java,
  Ruby, PHP, C/C++, C#, Swift, Kotlin, and more`)
  .action(async (path: string, options) => {
    try {
      const projectPath = path === '.' ? process.cwd() : path;
      
      const db = new PrimordynDB(projectPath);
      const indexer = new Indexer(db);
      
      // Handle clear option
      if (options.clear) {
        const dbInfo = await db.getDatabaseInfo();
        
        if (dbInfo.fileCount > 0) {
          if (!options.quiet) {
            console.log(chalk.yellow('⚠️  Clearing existing index:'));
            console.log(`   • ${dbInfo.fileCount.toLocaleString()} files`);
            console.log(`   • ${dbInfo.symbolCount.toLocaleString()} symbols`);
          }
          
          await indexer.clearIndex();
          if (!options.quiet) {
            console.log(chalk.green('✓ Index cleared'));
          }
        }
      }
      
      if (!options.quiet) {
        console.log(chalk.blue('🔍 Indexing codebase:'), chalk.cyan(projectPath));
      }
      
      const languages = options.languages ? options.languages.split(',').map((l: string) => l.trim()) : undefined;
      const maxFileSize = parseInt(options.maxSize) * 1024; // Convert KB to bytes
      
      const stats = await indexer.index({
        projectRoot: projectPath,
        languages,
        maxFileSize,
        updateExisting: options.update,
        verbose: false // Let the command handle all output formatting
      });
      
      if (!options.quiet) {
        console.log('\n' + chalk.green('✅ Indexing complete!'));
        console.log(chalk.blue('📊 Summary:'));
        console.log(`  • Files indexed: ${chalk.yellow(stats.filesIndexed)}`);
        console.log(`  • Symbols extracted: ${chalk.yellow(stats.symbolsExtracted)}`);
        console.log(`  • Total tokens: ${chalk.yellow(stats.totalTokens.toLocaleString())}`);
        console.log(`  • Time elapsed: ${chalk.yellow((stats.timeElapsed / 1000).toFixed(2))}s`);
        
        if (stats.errors > 0) {
          console.log(`  • Errors: ${chalk.red(stats.errors)}`);
        }
        
        console.log('\n' + chalk.green('💡 Next:'), chalk.cyan('primordyn query "search term"'));
      } else {
        // Minimal output for AI agents
        console.log(JSON.stringify({
          indexed: stats.filesIndexed,
          symbols: stats.symbolsExtracted, 
          tokens: stats.totalTokens,
          time_ms: stats.timeElapsed,
          errors: stats.errors
        }));
      }
      
      db.close();
      
    } catch (error) {
      console.error(chalk.red('❌ Indexing failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });