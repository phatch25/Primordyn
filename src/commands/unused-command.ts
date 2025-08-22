import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import chalk from 'chalk';
import ora from 'ora';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const unusedCommand =
  new Command('unused')
    .description('Find unused symbols (dead code) in the codebase')
    .option('-t, --type <type>', 'Filter by symbol type (function, class, interface, etc.)')
    .option('-f, --file <pattern>', 'Filter by file pattern')
    .option('--show-exports', 'Include exported symbols that are never imported')
    .option('--ignore-tests', 'Ignore test files when checking usage')
    .option('--min-lines <number>', 'Only show symbols with at least N lines', parseInt)
    .action(async (options) => {
      const spinner = ora('Analyzing codebase for unused symbols...').start();
      
      try {
        const db = new PrimordynDB();
        const projectRoot = process.cwd();
        const dbPath = join(projectRoot, '.primordyn', 'context.db');
        
        const dbInfo = await db.getDatabaseInfo();
        if (dbInfo.fileCount === 0) {
          spinner.fail(chalk.red('No index found. Run "primordyn index" first.'));
          process.exit(1);
        }
        
        // Find all symbols with zero incoming references
        let query = `
          SELECT 
            s.id,
            s.name,
            s.type,
            f.path as file_path,
            s.line_start,
            s.line_end,
            f.relative_path,
            (s.line_end - s.line_start + 1) as line_count
          FROM symbols s
          JOIN files f ON s.file_id = f.id
          WHERE s.id NOT IN (
            SELECT DISTINCT callee_symbol_id 
            FROM call_graph 
            WHERE callee_symbol_id IS NOT NULL
          )
        `;
        
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
        
        if (options.ignoreTests) {
          conditions.push("f.relative_path NOT LIKE '%test%'");
          conditions.push("f.relative_path NOT LIKE '%spec%'");
          conditions.push("f.relative_path NOT LIKE '%__tests__%'");
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
        
        console.log(chalk.yellow(`\n🔍 Found ${unusedSymbols.length} potentially unused symbols:\n`));
        
        let totalLines = 0;
        for (const [file, symbols] of byFile) {
          console.log(chalk.cyan(`\n${file}:`));
          for (const symbol of symbols) {
            const exported = '';
            const location = chalk.gray(`:${symbol.line_start}-${symbol.line_end}`);
            const lines = chalk.gray(`(${symbol.line_count} lines)`);
            console.log(`  ${chalk.red('○')} ${symbol.type} ${chalk.white(symbol.name)}${location} ${lines}${exported}`);
            totalLines += symbol.line_count;
          }
        }
        
        console.log(chalk.yellow(`\n📊 Summary:`));
        console.log(`  • ${unusedSymbols.length} unused symbols`);
        console.log(`  • ${byFile.size} affected files`);
        console.log(`  • ${totalLines} total lines of potentially dead code`);
        
        
        db.close();
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        process.exit(1);
      }
    });