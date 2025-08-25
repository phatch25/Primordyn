import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { Indexer } from '../indexer/index.js';
import chalk from 'chalk';
import { getHelpText } from '../utils/help-texts.js';

export const clearCommand = new Command('clear')
  .description('Clear the current index database')
  .option('-f, --force', 'Skip confirmation prompt')
  .addHelpText('after', getHelpText('clear'))
  .action(async (options) => {
    try {
      const db = new PrimordynDB();
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
      
      db.close();
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to clear index:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });