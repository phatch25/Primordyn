import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { Indexer } from '../indexer/index.js';
import chalk from 'chalk';
import { getHelpText } from '../utils/help-texts.js';

export const statsCommand = new Command('stats')
  .description('Show index status and project overview')
  .option('--json', 'Output JSON for AI agents')
  .option('--detailed', 'Show detailed breakdown')
  .addHelpText('after', getHelpText('stats'))
  .action(async (options) => {
    try {
      const db = new PrimordynDB();
      const indexer = new Indexer(db);
      
      const dbInfo = await db.getDatabaseInfo();
      const indexStats = await indexer.getIndexStats();
      
      if (options.json) {
        console.log(JSON.stringify({
          status: dbInfo.fileCount > 0 ? 'indexed' : 'empty',
          files: dbInfo.fileCount,
          symbols: dbInfo.symbolCount,
          tokens: indexStats.totalTokens,
          last_indexed: dbInfo.lastIndexed?.toISOString() || null,
          languages: indexStats.languages,
          largest_files: indexStats.largestFiles.slice(0, 5)
        }, null, 2));
        db.close();
        return;
      }
      
      // Text output
      console.log(chalk.blue('📊 Primordyn Index Statistics'));
      console.log(chalk.gray('═'.repeat(50)));
      
      if (dbInfo.fileCount === 0) {
        console.log(chalk.yellow('No files indexed yet.'));
        console.log('\n' + chalk.green('💡 Get started:'));
        console.log(`  ${chalk.cyan('primordyn index')} - Index current directory`);
        console.log(`  ${chalk.cyan('primordyn index /path/to/project')} - Index specific path`);
        db.close();
        return;
      }
      
      // Overview
      console.log(chalk.green('\n📁 Overview:'));
      console.log(`  • Total files: ${chalk.yellow(dbInfo.fileCount.toLocaleString())}`);
      console.log(`  • Total symbols: ${chalk.yellow(dbInfo.symbolCount.toLocaleString())}`);
      console.log(`  • Total size: ${chalk.yellow(formatBytes(dbInfo.totalSize))}`);
      console.log(`  • Total tokens: ${chalk.yellow(indexStats.totalTokens.toLocaleString())}`);
      
      if (dbInfo.lastIndexed) {
        const timeAgo = formatTimeAgo(dbInfo.lastIndexed);
        console.log(`  • Last indexed: ${chalk.cyan(timeAgo)}`);
      }
      
      // Languages breakdown
      if (indexStats.languages.length > 0) {
        console.log(chalk.green('\n🗣️ Languages:'));
        const displayCount = options.detailed ? indexStats.languages.length : Math.min(10, indexStats.languages.length);
        
        for (let i = 0; i < displayCount; i++) {
          const lang = indexStats.languages[i];
          const percentage = ((lang.count / dbInfo.fileCount) * 100).toFixed(1);
          const bar = '█'.repeat(Math.round(lang.count / indexStats.languages[0].count * 20));
          console.log(`  ${chalk.cyan(lang.language.padEnd(12))} ${chalk.yellow(lang.count.toString().padStart(5))} files ${chalk.gray('(' + percentage + '%)')} ${chalk.blue(bar)}`);
        }
        
        if (!options.detailed && indexStats.languages.length > 10) {
          const remaining = indexStats.languages.length - 10;
          console.log(chalk.gray(`  ... and ${remaining} more languages`));
        }
      }
      
      // Largest files
      if (indexStats.largestFiles.length > 0) {
        console.log(chalk.green('\n📄 Largest Files:'));
        indexStats.largestFiles.slice(0, options.detailed ? 10 : 5).forEach((file, index) => {
          const size = formatBytes(file.size);
          const tokens = file.tokens ? file.tokens.toLocaleString() : 'unknown';
          console.log(`  ${chalk.blue((index + 1).toString().padStart(2))}. ${chalk.cyan(file.path.length > 50 ? '...' + file.path.slice(-47) : file.path)}`);
          console.log(`      ${chalk.gray('Size:')} ${chalk.yellow(size)} ${chalk.gray('| Tokens:')} ${chalk.yellow(tokens)}`);
        });
      }
      
      // Database info
      if (options.detailed) {
        console.log(chalk.green('\n🗄️ Database:'));
        console.log(`  • Location: ${chalk.cyan(db.getDatabasePath())}`);
        
        // Get database file size
        try {
          const fs = await import('fs');
          const stats = fs.statSync(db.getDatabasePath());
          console.log(`  • Size: ${chalk.yellow(formatBytes(stats.size))}`);
        } catch {
          // Ignore if can't read file stats
        }
      }
      
      // Quick tips
      console.log(chalk.green('\n💡 Quick Tips:'));
      console.log(`  • Search: ${chalk.cyan('primordyn query "search term"')}`);
      console.log(`  • Type filters: ${chalk.cyan('--type function|class|endpoint|decorator')}`);
      console.log(`  • Show impact: ${chalk.cyan('primordyn query "functionName" --impact')}`);
      console.log(`  • Skip refresh: ${chalk.cyan('primordyn query "term" --no-refresh')}`);
      
      db.close();
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to get statistics:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

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
  
  if (diffMinutes < 1) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays < 30) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}