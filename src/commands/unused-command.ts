import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import chalk from 'chalk';
import ora from 'ora';

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
    .option('--show-exports', 'Include exported symbols that are never imported')
    .option('--include-tests', 'Include test files when checking usage')
    .option('--include-docs', 'Include documentation files')
    .option('--include-examples', 'Include example files')
    .option('--include-config', 'Include configuration files')
    .option('--min-lines <number>', 'Only show symbols with at least N lines', parseInt)
    .option('--ignore <patterns...>', 'Custom patterns to ignore (e.g., "stories" "mock")')
    .option('--strict', 'Use strict mode (fewer exclusions, may have more false positives)')
    .option('--format <type>', 'Output format: text, json, markdown (default: text)', 'text')
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
        
        // Build the query with improved filtering
        let query = `
          SELECT 
            s.id,
            s.name,
            s.type,
            f.path as file_path,
            s.line_start,
            s.line_end,
            f.relative_path,
            s.signature,
            (s.line_end - s.line_start + 1) as line_count,
            -- Check if symbol is exported
            CASE 
              WHEN s.metadata LIKE '%"exported":true%' THEN 1
              WHEN s.name IN (
                SELECT DISTINCT name FROM symbols 
                WHERE type = 'export' AND file_id = s.file_id
              ) THEN 1
              ELSE 0
            END as is_exported
          FROM symbols s
          JOIN files f ON s.file_id = f.id
          WHERE s.id NOT IN (
            SELECT DISTINCT callee_symbol_id 
            FROM call_graph 
            WHERE callee_symbol_id IS NOT NULL
          )
        `;
        
        // Apply base filters unless in strict mode
        if (!options.strict) {
          query += `
          AND s.name NOT IN (
            'default', 'exports', 'module.exports',
            -- Common entry points
            'main', 'index', 'app', 'App', 'config', 'Config',
            -- CLI and scripts
            'cli', 'run', 'start', 'build', 'serve',
            -- React/Vue/Angular lifecycle
            'render', 'Component', 'Provider',
            'constructor', 'ngOnInit', 'mounted', 'created'
          )
          AND s.type NOT IN ('export', 'import', 'require')
          AND s.name NOT LIKE '\_%' -- Private convention
          AND s.name NOT LIKE '%Mock%'
          AND s.name NOT LIKE '%Stub%'
          `;
        } else {
          query += `
          AND s.name NOT IN ('default', 'exports', 'module.exports')
          AND s.type NOT IN ('export', 'import', 'require')
          `;
        }
        
        const params: any[] = [];
        const conditions: string[] = [];
        
        if (options.type) {
          conditions.push('s.type = ?');
          params.push(options.type);
        }
        
        if (options.file) {
          conditions.push('f.relative_path LIKE ?');
          params.push(`%${options.file}%`);
        }
        
        // Note: is_exported field doesn't exist in new schema
        
        // File filtering - default to excluding test/doc/example files
        if (!options.includeTests) {
          conditions.push("f.relative_path NOT LIKE '%test%'");
          conditions.push("f.relative_path NOT LIKE '%spec%'");
          conditions.push("f.relative_path NOT LIKE '%__tests__%'");
          conditions.push("f.relative_path NOT LIKE '%.test.%'");
          conditions.push("f.relative_path NOT LIKE '%.spec.%'");
        }
        
        if (!options.includeDocs) {
          conditions.push("f.relative_path NOT LIKE '%/docs/%'");
          conditions.push("f.relative_path NOT LIKE '%.md'");
          conditions.push("f.relative_path NOT LIKE '%README%'");
        }
        
        if (!options.includeExamples) {
          conditions.push("f.relative_path NOT LIKE '%/examples/%'");
          conditions.push("f.relative_path NOT LIKE '%/demo/%'");
          conditions.push("f.relative_path NOT LIKE '%.example.%'");
        }
        
        if (!options.includeConfig) {
          conditions.push("f.relative_path NOT LIKE '%.config.%'");
          conditions.push("f.relative_path NOT LIKE '%webpack.%'");
          conditions.push("f.relative_path NOT LIKE '%vite.%'");
        }
        
        // Custom ignore patterns
        if (options.ignore && options.ignore.length > 0) {
          for (const pattern of options.ignore) {
            conditions.push('f.relative_path NOT LIKE ?');
            params.push(`%${pattern}%`);
          }
        }
        
        if (options.minLines) {
          conditions.push('(s.line_end - s.line_start + 1) >= ?');
          params.push(options.minLines);
        }
        
        if (conditions.length > 0) {
          query += ' AND ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY f.relative_path, s.line_start';
        
        const stmt = db.getDatabase().prepare(query);
        const unusedSymbols = stmt.all(...params) as any[];
        
        spinner.stop();
        
        if (unusedSymbols.length === 0) {
          console.log(chalk.green('✨ No unused symbols found!'));
          db.close();
          return;
        }
        
        // Group by file for better display
        const byFile = new Map<string, any[]>();
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