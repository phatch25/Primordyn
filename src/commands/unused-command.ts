import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import chalk from 'chalk';
import ora from 'ora';
import { getHelpText } from '../utils/help-texts.js';
import type { UnusedSymbolQueryResult } from '../types/database.js';

function getSymbolIcon(type: string): string {
  const icons: Record<string, string> = {
    'function': '𝑓',
    'method': '𝑚',
    'class': '◆',
    'interface': '◇',
    'variable': '𝑣',
    'const': '𝑐',
    'type': '𝑡',
    'enum': '𝑒'
  };
  return icons[type.toLowerCase()] || '○';
}

export const unusedCommand =
  new Command('unused')
    .description('Find unused symbols (dead code) in the codebase')
    .option('-t, --type <type>', 'Filter by symbol type (function, class, interface, etc.)')
    .option('-f, --file <pattern>', 'Filter by file pattern')
    .option('--show-exports', 'Include exported symbols (they might be used externally)')
    .option('--include-tests', 'Include test files when checking usage')
    .option('--include-docs', 'Include documentation files')
    .option('--include-examples', 'Include example files')
    .option('--include-config', 'Include configuration files')
    .option('--min-lines <number>', 'Only show symbols with at least N lines', parseInt)
    .option('--ignore <patterns...>', 'Custom patterns to ignore (e.g., "stories" "mock")')
    .option('--strict', 'Use strict mode (fewer exclusions, may have more false positives)')
    .option('--format <type>', 'Output format: text, json, markdown (default: text)', 'text')
    .addHelpText('after', getHelpText('unused'))
    .action(async (options) => {
      const spinner = ora('Analyzing codebase for unused symbols...').start();
      
      try {
        const db = new PrimordynDB();
        // const projectRoot = process.cwd();
        // const dbPath = join(projectRoot, '.primordyn', 'context.db');
        
        const dbInfo = await db.getDatabaseInfo();
        if (dbInfo.fileCount === 0) {
          spinner.fail(chalk.red('No index found. Run "primordyn index" first.'));
          process.exit(1);
        }
        
        // Use the repository method with improved options
        const unusedSymbols = db.symbols.findUnused({
          type: options.type,
          file: options.file,
          ignoreTests: !options.includeTests,
          ignoreDocs: !options.includeDocs,
          ignoreExamples: !options.includeExamples,
          ignoreConfig: !options.includeConfig,
          ignoreExported: !options.showExports,
          minLines: options.minLines,
          customIgnore: options.ignore,
          strict: options.strict
        }) as unknown as UnusedSymbolQueryResult[];
        
        spinner.stop();
        
        if (unusedSymbols.length === 0) {
          console.log(chalk.green('✨ No unused symbols found!'));
          db.close();
          return;
        }
        
        // Group by file for better display
        const byFile = new Map<string, UnusedSymbolQueryResult[]>();
        for (const symbol of unusedSymbols) {
          if (!byFile.has(symbol.relative_path)) {
            byFile.set(symbol.relative_path, []);
          }
          byFile.get(symbol.relative_path)!.push(symbol);
        }
        
        // Calculate total lines first
        let totalLines = 0;
        for (const symbol of unusedSymbols) {
          totalLines += symbol.line_count;
        }
        
        // Format output based on option
        if (options.format === 'json') {
          const output = {
            total: unusedSymbols.length,
            files: byFile.size,
            totalLines: totalLines,
            symbols: Array.from(byFile.entries()).map(([file, symbols]) => ({
              file,
              symbols: symbols.map(s => ({
                name: s.name,
                type: s.type,
                lines: `${s.line_start}-${s.line_end}`,
                lineCount: s.line_count,
                exported: s.is_exported === 1
              }))
            }))
          };
          console.log(JSON.stringify(output, null, 2));
          db.close();
          return;
        }
        
        if (options.format === 'markdown') {
          console.log('# Unused Code Report\n');
          console.log(`Found **${unusedSymbols.length}** potentially unused symbols in **${byFile.size}** files.\n`);
          console.log(`Total lines of potentially dead code: **${totalLines}**\n`);
          
          for (const [file, symbols] of byFile) {
            console.log(`\n## ${file}\n`);
            console.log('| Symbol | Type | Lines | Size |');
            console.log('|--------|------|-------|------|');
            for (const symbol of symbols) {
              const exported = symbol.is_exported === 1 ? ' 📤' : '';
              console.log(`| ${symbol.name}${exported} | ${symbol.type} | ${symbol.line_start}-${symbol.line_end} | ${symbol.line_count} lines |`);
            }
          }
          
          console.log(`\n### Summary`);
          console.log(`- Total unused symbols: ${unusedSymbols.length}`);
          console.log(`- Affected files: ${byFile.size}`);
          console.log(`- Total lines of dead code: ${totalLines}`);
          db.close();
          return;
        }
        
        // Default text format
        console.log(chalk.yellow(`\n🔍 Found ${unusedSymbols.length} potentially unused symbols:\n`));
        
        for (const [file, symbols] of byFile) {
          console.log(chalk.cyan(`\n${file}:`));
          for (const symbol of symbols) {
            const exported = symbol.is_exported === 1 ? chalk.yellow(' [exported]') : '';
            const location = chalk.gray(`:${symbol.line_start}-${symbol.line_end}`);
            const lines = chalk.gray(`(${symbol.line_count} lines)`);
            const typeIcon = getSymbolIcon(symbol.type);
            console.log(`  ${chalk.red(typeIcon)} ${symbol.type} ${chalk.white(symbol.name)}${location} ${lines}${exported}`);
          }
        }
        
        // Enhanced summary with insights
        console.log(chalk.yellow(`\n📊 Summary:`));
        console.log(`  • ${unusedSymbols.length} unused symbols`);
        console.log(`  • ${byFile.size} affected files`);
        console.log(`  • ${totalLines} total lines of potentially dead code`);
        
        // Type breakdown
        const typeBreakdown = new Map<string, number>();
        for (const symbol of unusedSymbols) {
          typeBreakdown.set(symbol.type, (typeBreakdown.get(symbol.type) || 0) + 1);
        }
        
        if (typeBreakdown.size > 0) {
          console.log(chalk.yellow(`\n📈 By Type:`));
          const sortedTypes = Array.from(typeBreakdown.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
          for (const [type, count] of sortedTypes) {
            const percentage = ((count / unusedSymbols.length) * 100).toFixed(1);
            console.log(`  • ${type}: ${count} (${percentage}%)`);
          }
        }
        
        // Find largest unused blocks
        const largeBlocks = unusedSymbols
          .filter(s => s.line_count >= 20)
          .sort((a, b) => b.line_count - a.line_count)
          .slice(0, 5);
        
        if (largeBlocks.length > 0) {
          console.log(chalk.yellow(`\n🎯 Largest Unused Blocks:`));
          for (const block of largeBlocks) {
            console.log(`  • ${block.name} (${block.type}) - ${block.line_count} lines in ${block.relative_path}`);
          }
        }
        
        // Recommendations
        console.log(chalk.cyan(`\n💡 Recommendations:`));
        if (!options.strict) {
          console.log(`  • Run with --strict flag for more comprehensive detection`);
        }
        if (unusedSymbols.some(s => s.is_exported === 1)) {
          console.log(`  • Some symbols are exported - verify they're not part of a public API`);
        }
        console.log(`  • Review large unused blocks first for maximum impact`);
        console.log(`  • Consider if symbols are used via dynamic imports or reflection`);
        console.log(`  • Use --ignore patterns to exclude known false positives`);
        
        db.close();
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        process.exit(1);
      }
    });