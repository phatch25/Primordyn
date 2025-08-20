import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { Indexer } from '../indexer/index.js';
import chalk from 'chalk';
import { createInterface } from 'readline';

export const clearCommand = new Command('clear')
  .description('Clear the current index')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--vacuum', 'Also vacuum the database to reclaim space')
  .action(async (options) => {
    try {
      const db = new PrimordynDB();
      const indexer = new Indexer(db);
      
      // Get current stats before clearing
      const dbInfo = await db.getDatabaseInfo();
      
      if (dbInfo.fileCount === 0) {
        console.log(chalk.yellow('Index is already empty.'));
        db.close();
        return;
      }
      
      if (!options.force) {
        console.log(chalk.yellow('⚠️  This will permanently delete:'));
        console.log(`   • ${chalk.red(dbInfo.fileCount.toLocaleString())} indexed files`);
        console.log(`   • ${chalk.red(dbInfo.symbolCount.toLocaleString())} extracted symbols`);
        console.log(`   • All cached query results`);
        console.log();
        
        const confirmed = await askConfirmation('Are you sure you want to clear the index?');
        if (!confirmed) {
          console.log(chalk.gray('Operation cancelled.'));
          db.close();
          return;
        }
      }
      
      console.log(chalk.blue('🗑️  Clearing index...'));
      
      await indexer.clearIndex();
      
      if (options.vacuum) {
        console.log(chalk.blue('🧹 Vacuuming database...'));
        db.vacuum();
      }
      
      // Clean up expired cache
      db.cleanupExpiredCache();
      
      console.log(chalk.green('✅ Index cleared successfully!'));
      console.log();
      console.log(chalk.blue('💡 Next steps:'));
      console.log(`   • Run ${chalk.cyan('primordyn index')} to rebuild the index`);
      console.log(`   • Or index a specific path: ${chalk.cyan('primordyn index /path/to/project')}`);
      
      db.close();
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to clear index:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

function askConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(chalk.yellow(question + ' (y/N): '), (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}