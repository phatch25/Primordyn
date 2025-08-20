import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { Indexer } from '../indexer/index.js';
import chalk from 'chalk';

export const indexCommand = new Command('index')
  .description('Index a codebase for context retrieval')
  .argument('[path]', 'Path to index (defaults to current directory)', '.')
  .option('-l, --languages <langs>', 'Comma-separated list of languages to index (ts,js,py,go,rs,etc)')
  .option('-s, --max-file-size <size>', 'Maximum file size to index in KB', '1024')
  .option('--follow-symlinks', 'Follow symbolic links')
  .option('-u, --update', 'Update existing index (re-index changed files)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (path: string, options) => {
    try {
      const projectPath = path === '.' ? process.cwd() : path;
      
      console.log(chalk.blue('🔍 Indexing codebase:'), chalk.cyan(projectPath));
      
      const db = new PrimordynDB(projectPath);
      const indexer = new Indexer(db);
      
      const languages = options.languages ? options.languages.split(',').map((l: string) => l.trim()) : undefined;
      const maxFileSize = parseInt(options.maxFileSize) * 1024; // Convert KB to bytes
      
      const stats = await indexer.index({
        projectRoot: projectPath,
        languages,
        maxFileSize,
        followSymlinks: options.followSymlinks,
        updateExisting: options.update,
        verbose: options.verbose !== false
      });
      
      console.log('\n' + chalk.green('✅ Indexing complete!'));
      console.log(chalk.gray('━'.repeat(50)));
      console.log(chalk.blue('📊 Summary:'));
      console.log(`  • Files indexed: ${chalk.yellow(stats.filesIndexed)}`);
      console.log(`  • Symbols extracted: ${chalk.yellow(stats.symbolsExtracted)}`);
      console.log(`  • Total tokens: ${chalk.yellow(stats.totalTokens.toLocaleString())}`);
      console.log(`  • Time elapsed: ${chalk.yellow((stats.timeElapsed / 1000).toFixed(2))}s`);
      
      if (stats.errors > 0) {
        console.log(`  • Errors: ${chalk.red(stats.errors)}`);
      }
      
      console.log('\n' + chalk.green('💡 Try:'), chalk.cyan('primordyn query "your search term"'));
      
      db.close();
      
    } catch (error) {
      console.error(chalk.red('❌ Indexing failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });