import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import chalk from 'chalk';
import ora from 'ora';
import { createHash } from 'crypto';
import { getHelpText } from '../utils/help-texts.js';
import type { DuplicateSymbolQueryResult } from '../types/database.js';
import { withDefaults } from '../config/defaults.js';

interface DuplicateGroup {
  hash: string;
  symbols: DuplicateSymbolQueryResult[];
}

export const duplicatesCommand =
  new Command('duplicates')
    .description('Find duplicate code blocks across the codebase')
    .option('--min-lines <number>', 'Minimum lines for duplicate detection (default: 5)', parseInt, 5)
    .option('--min-tokens <number>', 'Minimum tokens for duplicate detection (default: 50)', parseInt, 50)
    .option('-t, --type <type>', 'Filter by symbol type (function, class, etc.)')
    .option('--show-content', 'Show the duplicated code content')
    .option('--ignore-tests', 'Ignore test files')
    .addHelpText('after', getHelpText('duplicates'))
    .action(async (options) => {
      const spinner = ora('Analyzing codebase for duplicate code...').start();
      
      try {
        const db = new PrimordynDB();
        // const projectRoot = process.cwd();
        // const dbPath = join(projectRoot, '.primordyn', 'context.db');
        
        const dbInfo = await db.getDatabaseInfo();
        if (dbInfo.fileCount === 0) {
          spinner.fail(chalk.red('No index found. Run "primordyn index" first.'));
          process.exit(1);
        }
        
        // Build query for symbols
        let query = `
          SELECT 
            s.name,
            s.type,
            f.path as file_path,
            s.line_start,
            s.line_end,
            s.signature as content,
            f.relative_path,
            (s.line_end - s.line_start + 1) as line_count
          FROM symbols s
          JOIN files f ON s.file_id = f.id
          WHERE s.signature IS NOT NULL
            AND s.signature != ''
            AND (s.line_end - s.line_start + 1) >= ?
        `;
        
        // Apply smart defaults
        const dupDefaults = withDefaults('duplicates', {
          minLines: options.minLines || 10,  // Focus on significant duplication
          ignoreTests: options.ignoreTests !== false,  // Default true
          type: options.type,
          showContent: options.showContent || false
        });
        
        const params: (string | number)[] = [dupDefaults.minLines];
        
        // Note: token_count field doesn't exist in new schema
        
        if (dupDefaults.type) {
          query += ' AND s.type = ?';
          params.push(dupDefaults.type);
        }
        
        if (dupDefaults.ignoreTests) {
          query += ` AND f.relative_path NOT LIKE '%test%'
                     AND f.relative_path NOT LIKE '%spec%'
                     AND f.relative_path NOT LIKE '%__tests__%'`;
        }
        
        const stmt = db.getDatabase().prepare(query);
        const symbols = stmt.all(...params) as DuplicateSymbolQueryResult[];
        
        // Create normalized hashes for comparison
        const duplicateMap = new Map<string, DuplicateSymbolQueryResult[]>();
        
        for (const symbol of symbols) {
          // Normalize content: remove whitespace variations, comments
          const normalizedContent = symbol.content
            .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
            .replace(/\/\/.*/g, '') // Remove line comments
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/['"]/g, '') // Ignore quote differences
            .trim();
          
          const hash = createHash('md5').update(normalizedContent).digest('hex');
          
          if (!duplicateMap.has(hash)) {
            duplicateMap.set(hash, []);
          }
          duplicateMap.get(hash)!.push(symbol);
        }
        
        // Filter to only keep actual duplicates
        const duplicateGroups: DuplicateGroup[] = [];
        for (const [hash, group] of duplicateMap) {
          if (group.length > 1) {
            duplicateGroups.push({ hash, symbols: group });
          }
        }
        
        spinner.stop();
        
        if (duplicateGroups.length === 0) {
          console.log(chalk.green('✨ No duplicate code blocks found!'));
          db.close();
          return;
        }
        
        // Sort by total lines duplicated
        duplicateGroups.sort((a, b) => {
          const aLines = a.symbols.reduce((sum, s) => sum + s.line_count, 0);
          const bLines = b.symbols.reduce((sum, s) => sum + s.line_count, 0);
          return bLines - aLines;
        });
        
        console.log(chalk.yellow(`\n🔍 Found ${duplicateGroups.length} groups of duplicate code:\n`));
        
        let totalDuplicateLines = 0;
        let groupIndex = 0;
        
        // Limit output for better UX (can be overridden with --all flag later)
        const displayLimit = 20;
        for (const group of duplicateGroups.slice(0, displayLimit)) {
          groupIndex++;
          const duplicateCount = group.symbols.length;
          const lineCount = group.symbols[0].line_count;
          const wastedLines = lineCount * (duplicateCount - 1);
          totalDuplicateLines += wastedLines;
          
          console.log(chalk.cyan(`\n${groupIndex}. Duplicate ${group.symbols[0].type} (${lineCount} lines, ${duplicateCount} copies):`));
          
          for (const symbol of group.symbols) {
            console.log(`   ${chalk.red('●')} ${symbol.relative_path}:${symbol.line_start}-${symbol.line_end} - ${chalk.white(symbol.name)}`);
          }
          
          if (dupDefaults.showContent && group.symbols[0].content) {
            console.log(chalk.gray('\n   Content preview:'));
            const preview = group.symbols[0].content.split('\n').slice(0, 5).join('\n');
            console.log(chalk.gray(preview.split('\n').map(line => '   │ ' + line).join('\n')));
            if (group.symbols[0].content.split('\n').length > 5) {
              console.log(chalk.gray('   │ ...'));
            }
          }
          
          console.log(chalk.yellow(`   ⚠️  ${wastedLines} duplicate lines could be refactored`));
        }
        
        // Calculate statistics
        const totalGroups = duplicateGroups.length;
        const affectedFiles = new Set(duplicateGroups.flatMap(g => g.symbols.map(s => s.file_path))).size;
        
        // Find the most duplicated symbols
        const symbolCounts = new Map<string, number>();
        for (const group of duplicateGroups) {
          for (const symbol of group.symbols) {
            const key = `${symbol.type} ${symbol.name}`;
            symbolCounts.set(key, (symbolCounts.get(key) || 0) + 1);
          }
        }
        
        console.log(chalk.yellow('\n📊 DUPLICATION SUMMARY:'));
        console.log(`  • ${chalk.white(totalGroups)} duplicate groups found`);
        console.log(`  • ${chalk.white(affectedFiles)} files contain duplicates`);
        console.log(`  • ${chalk.red(totalDuplicateLines)} total duplicate lines that could be eliminated`);
        
        // Refactoring suggestions
        console.log(chalk.cyan('\n💡 REFACTORING SUGGESTIONS:'));
        
        // Find patterns in duplicates
        const functionDupes = duplicateGroups.filter(g => g.symbols[0].type === 'function').length;
        const classDupes = duplicateGroups.filter(g => g.symbols[0].type === 'class').length;
        
        if (functionDupes > 5) {
          console.log(`  • ${chalk.yellow(functionDupes)} duplicate functions could be moved to a shared utility module`);
        }
        
        if (classDupes > 2) {
          console.log(`  • ${chalk.yellow(classDupes)} duplicate classes suggest need for inheritance or composition`);
        }
        
        // Check for cross-file duplication
        const crossFileDupes = duplicateGroups.filter(g => {
          const files = new Set(g.symbols.map(s => s.file_path));
          return files.size > 1;
        }).length;
        
        if (crossFileDupes > 0) {
          console.log(`  • ${chalk.yellow(crossFileDupes)} duplicates span multiple files - consider extracting to shared modules`);
        }
        
        // Estimate time savings
        const estimatedHoursSaved = Math.round(totalDuplicateLines / 100);
        if (estimatedHoursSaved > 0) {
          console.log(`  • Removing duplicates could save ~${chalk.green(estimatedHoursSaved)} hours of future maintenance`);
        }
        
        db.close();
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        process.exit(1);
      }
    });