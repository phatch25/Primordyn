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
${chalk.bold('Details:')}
  The index command scans your codebase and extracts symbols (functions, classes,
  interfaces, types) along with their relationships, creating a searchable database
  for AI context retrieval.

${chalk.bold('Features:')}
  • Incremental updates - Only re-indexes changed files
  • Language-aware parsing - Extracts symbols using AST parsing
  • Relationship tracking - Maps dependencies and call graphs
  • Token counting - Tracks context size for AI models
  • Gitignore respect - Automatically excludes ignored files

${chalk.bold('Examples:')}
  ${chalk.gray('# Index current directory')}
  $ primordyn index

  ${chalk.gray('# Index specific directory')}
  $ primordyn index ./src

  ${chalk.gray('# Clear and rebuild index')}
  $ primordyn index --clear

  ${chalk.gray('# Index only TypeScript and JavaScript files')}
  $ primordyn index --languages ts,js

  ${chalk.gray('# Index with custom file size limit (2MB)')}
  $ primordyn index --max-size 2048

  ${chalk.gray('# Quick incremental update')}
  $ primordyn index --update --quiet

${chalk.bold('Supported Languages:')}
  • TypeScript (ts, tsx)
  • JavaScript (js, jsx, mjs)
  • Python (py)
  • Go (go)
  • Rust (rs)
  • Java (java)
  • Ruby (rb)
  • PHP (php)
  • C/C++ (c, cpp, h, hpp)
  • C# (cs)
  • Swift (swift)
  • Kotlin (kt)

${chalk.bold('Notes:')}
  • Index is stored in .primordyn/context.db
  • Use --update for faster incremental updates
  • Large files over the size limit are skipped
  • Binary files and dependencies (node_modules) are ignored`)
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
        verbose: !options.quiet
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