import { Command } from 'commander';
import { BaseCommand } from './base-command.js';
import chalk from 'chalk';

interface UnusedCommandOptions {
  type?: string;
  file?: string;
  ignoreTests?: boolean;
  minLines?: number;
  format?: 'text' | 'json';
}

export class UnusedCommand extends BaseCommand {
  register(program: Command): void {
    program
      .command('unused')
      .description('Find unused symbols (dead code) in the codebase')
      .option('-t, --type <type>', 'Filter by symbol type (function, class, etc.)')
      .option('-f, --file <pattern>', 'Filter by file pattern')
      .option('--ignore-tests', 'Ignore test files', false)
      .option('--min-lines <number>', 'Minimum lines of code', parseInt)
      .option('--format <format>', 'Output format (text, json)', 'text')
      .action(async (options: UnusedCommandOptions) => {
        try {
          await this.execute(options);
        } catch (error) {
          this.handleError(error);
        }
      });
  }

  async execute(options: UnusedCommandOptions): Promise<void> {
    this.startSpinner('Analyzing codebase for unused symbols...');
    
    try {
      await this.initialize();
      
      // Find unused symbols using repository
      const unusedSymbols = this.db.symbols.findUnused({
        type: options.type,
        file: options.file,
        ignoreTests: options.ignoreTests,
        minLines: options.minLines
      });

      this.stopSpinner();

      if (options.format === 'json') {
        this.outputJson(unusedSymbols);
        return;
      }

      this.outputText(unusedSymbols, options);
    } finally {
      this.cleanup();
    }
  }

  private outputJson(symbols: any[]): void {
    const grouped = this.groupByFile(symbols);
    const output = {
      total: symbols.length,
      files: Object.keys(grouped).length,
      symbols: grouped
    };
    console.log(this.formatJson(output));
  }

  private outputText(symbols: any[], options: UnusedCommandOptions): void {
    if (symbols.length === 0) {
      console.log(this.formatter.formatSuccess('No unused symbols found!'));
      return;
    }

    const grouped = this.groupByFile(symbols);
    const totalLines = symbols.reduce((sum, s) => sum + s.line_count, 0);

    console.log(this.formatter.formatHeader(`\n🔍 Found ${symbols.length} potentially unused symbols:\n`));

    for (const [file, fileSymbols] of Object.entries(grouped)) {
      console.log(`\n${chalk.cyan(file)}:`);
      
      for (const symbol of fileSymbols as any[]) {
        const location = `${symbol.line_start}-${symbol.line_end}`;
        const lineInfo = symbol.line_count > 1 
          ? `(${symbol.line_count} lines)` 
          : '(1 line)';
        
        console.log(`  ○ ${symbol.type} ${chalk.white(symbol.name)}:${location} ${chalk.gray(lineInfo)}`);
      }
    }

    // Summary
    console.log(this.formatter.formatSummary('Summary', [
      { label: 'Unused symbols', value: symbols.length },
      { label: 'Affected files', value: Object.keys(grouped).length },
      { label: 'Total lines of potentially dead code', value: totalLines }
    ]));

    // Provide actionable insights
    this.provideInsights(symbols);
  }

  private groupByFile(symbols: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    
    for (const symbol of symbols) {
      const file = symbol.relative_path;
      if (!grouped[file]) {
        grouped[file] = [];
      }
      grouped[file].push(symbol);
    }
    
    return grouped;
  }

  private provideInsights(symbols: any[]): void {
    const byType = this.groupByType(symbols);
    const largeUnused = symbols.filter(s => s.line_count >= 20);
    
    console.log(this.formatter.formatHeader('\n💡 Insights:'));
    
    // Most common unused types
    const sortedTypes = Object.entries(byType)
      .sort(([, a], [, b]) => b.length - a.length)
      .slice(0, 3);
    
    if (sortedTypes.length > 0) {
      console.log(`  • Most unused: ${sortedTypes.map(([type, items]) => 
        `${type} (${items.length})`).join(', ')}`);
    }
    
    // Large unused code blocks
    if (largeUnused.length > 0) {
      console.log(`  • ${largeUnused.length} large unused blocks (20+ lines) - high priority for removal`);
    }
    
    // Recommendations
    console.log(this.formatter.formatHeader('\n📝 Recommendations:'));
    console.log('  • Review large unused blocks first for maximum impact');
    console.log('  • Verify exported symbols are not part of a public API');
    console.log('  • Consider if symbols are used via dynamic imports or reflection');
    console.log('  • Use --ignore patterns to exclude known false positives');
    console.log('  • Run with --strict for more comprehensive detection');
  }

  private groupByType(symbols: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    
    for (const symbol of symbols) {
      if (!grouped[symbol.type]) {
        grouped[symbol.type] = [];
      }
      grouped[symbol.type].push(symbol);
    }
    
    return grouped;
  }
  
  private getSymbolIcon(type: string): string {
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
}