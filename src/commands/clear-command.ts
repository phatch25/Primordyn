import { Command } from 'commander';
import { DatabaseConnectionPool } from '../database/connection-pool.js';
import { Indexer } from '../indexer/index.js';
import chalk from 'chalk';

export const clearCommand = new Command('clear')
  .description('Clear the current index database')
  .option('-f, --force', 'Skip confirmation prompt')
  .addHelpText('after', `
${chalk.bold('Purpose:')}
  Remove the entire index database to start fresh. Useful when the index
  is corrupted or you want to rebuild from scratch.

${chalk.bold('Examples:')}
  ${chalk.gray('# Clear with confirmation prompt')}
  $ primordyn clear
  
  ${chalk.gray('# Clear without confirmation')}
  $ primordyn clear --force

${chalk.bold('What it does:')}
  • Deletes all indexed symbols
  • Removes all file records
  • Vacuums database to reclaim space
  • Requires re-indexing afterward

${chalk.bold('Use when:')}
  • Index seems corrupted
  • Major project restructuring
  • Switching branches significantly
  • Before archiving project`)
  .action(async (options) => {
    try {
      const db = DatabaseConnectionPool.getConnection();
      const indexer = new Indexer(db);
      
      if (!options.force) {
        console.log(chalk.yellow('⚠️  This will delete all indexed data.'));
        console.log(chalk.gray('Use --force to skip this confirmation.'));
        console.log();
        process.exit(0);
      }
      
      console.log(chalk.blue('🗑️  Clearing index...'));
      await indexer.clearIndex();
      
      // Also vacuum to reclaim space
      db.vacuum();
      
      console.log(chalk.green('✅ Index cleared successfully!'));
      console.log();
      console.log(chalk.blue('💡 Next step:'));
      console.log(`  Run ${chalk.cyan('primordyn index')} to rebuild the index`);
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to clear index:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });