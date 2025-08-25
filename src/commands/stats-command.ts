import { Command } from 'commander';
import { DatabaseConnectionPool } from '../database/connection-pool.js';
import { Indexer } from '../indexer/index.js';
import chalk from 'chalk';

export const statsCommand = new Command('stats')
  .description('Show index statistics and project overview')
  .option('--json', 'Output as JSON')
  .option('--detailed', 'Show additional details')
  .action(async (options) => {
    try {
      const db = DatabaseConnectionPool.getConnection();
      const indexer = new Indexer(db);
      
      const dbInfo = await db.getDatabaseInfo();
      const indexStats = await indexer.getIndexStats();
      
      if (options.json) {
        console.log(JSON.stringify({
          indexed: dbInfo.fileCount > 0,
          files: dbInfo.fileCount,
          symbols: dbInfo.symbolCount,
          tokens: indexStats.totalTokens,
          lastIndexed: dbInfo.lastIndexed?.toISOString() || null,
          languages: indexStats.languages,
          largestFiles: indexStats.largestFiles.slice(0, 5)
        }, null, 2));
        return;
      }
      
      // No index yet
      if (dbInfo.fileCount === 0) {
        console.log(chalk.yellow('No index found.'));
        console.log(chalk.gray('Run: primordyn index'));
        return;
      }
      
      // Overview
      console.log(chalk.bold('Index Statistics'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`Files:    ${chalk.yellow(dbInfo.fileCount.toLocaleString())}`);
      console.log(`Symbols:  ${chalk.yellow(dbInfo.symbolCount.toLocaleString())}`);
      console.log(`Tokens:   ${chalk.yellow(indexStats.totalTokens.toLocaleString())}`);
      console.log(`Size:     ${chalk.yellow(formatBytes(dbInfo.totalSize))}`);
      
      if (dbInfo.lastIndexed) {
        console.log(`Updated:  ${chalk.cyan(formatTimeAgo(dbInfo.lastIndexed))}`);
      }
      
      // Languages
      if (indexStats.languages.length > 0) {
        console.log(chalk.gray('\nLanguages:'));
        const maxShow = options.detailed ? 15 : 5;
        indexStats.languages.slice(0, maxShow).forEach(lang => {
          const pct = ((lang.count / dbInfo.fileCount) * 100).toFixed(1);
          console.log(`  ${lang.language.padEnd(12)} ${lang.count.toString().padStart(4)} files (${pct}%)`);
        });
        
        if (indexStats.languages.length > maxShow) {
          console.log(chalk.gray(`  ... and ${indexStats.languages.length - maxShow} more`));
        }
      }
      
      // Largest files (only in detailed mode)
      if (options.detailed && indexStats.largestFiles.length > 0) {
        console.log(chalk.gray('\nLargest files:'));
        indexStats.largestFiles.slice(0, 5).forEach(file => {
          const name = file.path.length > 50 ? '...' + file.path.slice(-47) : file.path;
          console.log(`  ${name}`);
          console.log(chalk.gray(`    ${formatBytes(file.size)} | ${file.tokens?.toLocaleString() || '?'} tokens`));
        });
      }
      
      // Database location (only in detailed mode)
      if (options.detailed) {
        console.log(chalk.gray(`\nDatabase: ${db.getDatabasePath()}`));
      }
      
    } catch (error) {
      console.error(chalk.red('Failed to get statistics:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  })
  .addHelpText('after', `
${chalk.bold('Purpose:')}
  Get a quick overview of your indexed codebase. Shows statistics about
  files, symbols, languages, and index status.

${chalk.bold('Examples:')}
  ${chalk.gray('# Show index overview')}
  $ primordyn stats
  ${chalk.gray('→ Files: 245, Symbols: 1,847, Tokens: 125,432')}
  
  ${chalk.gray('# Show detailed breakdown with largest files')}
  $ primordyn stats --detailed
  
  ${chalk.gray('# Get JSON for automation')}
  $ primordyn stats --json

${chalk.bold('What it shows:')}
  • File and symbol counts
  • Total token usage (for AI context)
  • Language distribution
  • Index size and last update
  • Largest files (--detailed)

${chalk.bold('Use to:')}
  • Check if index exists
  • Monitor index freshness
  • Understand project composition
  • Track token budget for AI`);

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}