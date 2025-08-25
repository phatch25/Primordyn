import { Command } from 'commander';
import { DatabaseConnectionPool } from '../database/connection-pool.js';
import { ContextRetriever } from '../retriever/index.js';
import { validateLanguages, validateTokenLimit, ValidationError } from '../utils/validation.js';
import { AliasManager } from '../config/aliases.js';
import chalk from 'chalk';
import { SymbolResult, FileResult } from '../types/index.js';
import { getHelpText } from '../utils/help-texts.js';

interface ListCommandOptions {
  languages?: string;
  type?: string;
  limit?: string;
  showFiles?: boolean;
  showSymbols?: boolean;
  detailed?: boolean;
  useAlias?: boolean;
  format?: string;
}

interface ListResult {
  symbols: SymbolResult[];
  files: FileResult[];
  totalSymbols: number;
  totalFiles: number;
}

export const listCommand = new Command('list')
  .description('List and search symbols, files, and patterns across the codebase')
  .argument('[search-pattern]', 'Optional search pattern (supports wildcards and fuzzy matching)')
  .option('--type <symbol-type>', 'Filter by symbol type: function,class,interface,method,endpoint,etc')
  .option('--languages <langs>', 'Filter by languages: ts,js,py,go,etc')
  .option('--limit <n>', 'Maximum number of results per category (default: 20)', '20')
  .option('--show-files', 'Include file matches in results')
  .option('--show-symbols', 'Include symbol matches in results (default)', true)
  .option('--detailed', 'Show detailed information for each match')
  .option('--use-alias', 'Enable alias expansion for search pattern')
  .option('--format <type>', 'Output format: human, json, simple (default: human)', 'human')
  .addHelpText('after', getHelpText('list'))
  .action(async (searchPattern: string | undefined, options: ListCommandOptions) => {
    try {
      const db = DatabaseConnectionPool.getConnection();
      
      // Check if index exists
      const dbInfo = await db.getDatabaseInfo();
      if (dbInfo.fileCount === 0) {
        console.log(chalk.yellow('⚠️ No index found. Please run "primordyn index" first.'));
        process.exit(1);
      }
      
      const fileTypes = options.languages ? validateLanguages(options.languages) : undefined;
      const limit = parseInt(options.limit || '20', 10);
      const symbolType = options.type;
      
      // Expand search pattern using aliases if enabled
      let expandedPattern = searchPattern;
      if (searchPattern && options.useAlias) {
        const aliasManager = new AliasManager(process.cwd());
        expandedPattern = aliasManager.expandAlias(searchPattern);
        
        if (expandedPattern !== searchPattern) {
          console.log(chalk.gray(`Expanded alias "${searchPattern}" to: ${expandedPattern}`));
        }
      }
      
      const retriever = new ContextRetriever(db);
      const result: ListResult = {
        symbols: [],
        files: [],
        totalSymbols: 0,
        totalFiles: 0
      };
      
      // Get symbols if requested (default behavior)
      if (options.showSymbols !== false) {
        if (expandedPattern) {
          // Search for specific pattern
          result.symbols = await retriever.findSymbol(expandedPattern, { 
            fileTypes, 
            symbolType
          });
          
          // If no exact matches, try fuzzy search
          if (result.symbols.length === 0) {
            const suggestions = await retriever.getFuzzySuggestions(expandedPattern, limit);
            // Convert suggestions to symbol search
            for (const suggestion of suggestions.slice(0, 5)) {
              const suggestedSymbols = await retriever.findSymbol(suggestion, { 
                fileTypes, 
                symbolType
              });
              // Limit to 5 per suggestion
              const limitedSymbols = suggestedSymbols.slice(0, 5);
              result.symbols.push(...limitedSymbols);
            }
          }
        } else {
          // List all symbols of specified type
          result.symbols = await retriever.listAllSymbols({ 
            fileTypes, 
            symbolType,
            limit: limit * 2
          });
        }
        
        // Apply limit
        result.totalSymbols = result.symbols.length;
        result.symbols = result.symbols.slice(0, limit);
      }
      
      // Get files if requested
      if (options.showFiles) {
        if (expandedPattern) {
          // Search for files containing the pattern
          const searchResult = await retriever.query(expandedPattern, {
            maxTokens: validateTokenLimit('1000'),
            includeContent: false,
            includeSymbols: false,
            fileTypes,
            sortBy: 'relevance'
          });
          result.files = searchResult.files;
        } else {
          // List all indexed files
          result.files = await retriever.listAllFiles({ 
            fileTypes,
            limit: limit * 2
          });
        }
        
        // Apply limit
        result.totalFiles = result.files.length;
        result.files = result.files.slice(0, limit);
      }
      
      // Output results based on format
      switch (options.format) {
        case 'json':
          console.log(JSON.stringify(result, null, 2));
          break;
          
        case 'simple':
          outputSimpleFormat(result, searchPattern, options);
          break;
          
        default:
          outputHumanFormat(result, searchPattern, options);
      }
      
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(chalk.red('❌ Validation error:'), error.message);
      } else {
        console.error(chalk.red('❌ List failed:'), error instanceof Error ? error.message : error);
      }
      process.exit(1);
    }
  });

function outputSimpleFormat(result: ListResult, _searchPattern: string | undefined, _options: ListCommandOptions) {
  // Simple format for easy parsing/piping
  if (result.symbols.length > 0) {
    result.symbols.forEach(sym => {
      console.log(`symbol:${sym.type}:${sym.name}:${sym.filePath}:${sym.lineStart}`);
    });
  }
  
  if (result.files.length > 0) {
    result.files.forEach(file => {
      console.log(`file:${file.language}:${file.relativePath}:${file.tokens}`);
    });
  }
}

function outputHumanFormat(result: ListResult, searchPattern: string | undefined, options: ListCommandOptions) {
  const title = searchPattern 
    ? `🔍 Results for: "${searchPattern}"`
    : '📋 Listing codebase contents';
    
  console.log(chalk.blue(title));
  console.log(chalk.gray('═'.repeat(60)));
  
  // Show symbols
  if (result.symbols.length > 0) {
    console.log(chalk.green('\n📦 Symbols:'));
    
    if (options.detailed) {
      // Group by type for detailed view
      const byType: Record<string, typeof result.symbols> = {};
      result.symbols.forEach(sym => {
        if (!byType[sym.type]) byType[sym.type] = [];
        byType[sym.type].push(sym);
      });
      
      Object.entries(byType).forEach(([type, syms]) => {
        console.log(chalk.cyan(`\n  ${type}s (${syms.length}):`));
        syms.forEach(sym => {
          console.log(`    • ${chalk.yellow(sym.name)}`);
          console.log(chalk.gray(`      ${sym.filePath}:${sym.lineStart}`));
          if (sym.signature && sym.signature.length < 100) {
            console.log(chalk.gray(`      ${sym.signature}`));
          }
        });
      });
    } else {
      // Simple list view
      result.symbols.forEach((sym, i) => {
        const num = chalk.gray(`${(i + 1).toString().padStart(2)}.`);
        const type = chalk.cyan(`[${sym.type}]`.padEnd(12));
        const name = chalk.yellow(sym.name.padEnd(30));
        const location = chalk.gray(`${sym.filePath}:${sym.lineStart}`);
        console.log(`  ${num} ${type} ${name} ${location}`);
      });
    }
    
    if (result.totalSymbols > result.symbols.length) {
      console.log(chalk.gray(`\n  ... and ${result.totalSymbols - result.symbols.length} more symbols (use --limit to see more)`));
    }
  }
  
  // Show files
  if (result.files.length > 0) {
    console.log(chalk.green('\n📄 Files:'));
    
    if (options.detailed) {
      // Group by language for detailed view
      const byLang: Record<string, typeof result.files> = {};
      result.files.forEach(file => {
        const lang = file.language || 'unknown';
        if (!byLang[lang]) byLang[lang] = [];
        byLang[lang].push(file);
      });
      
      Object.entries(byLang).forEach(([lang, files]) => {
        console.log(chalk.cyan(`\n  ${lang} (${files.length}):`));
        files.forEach(file => {
          console.log(`    • ${chalk.yellow(file.relativePath)}`);
          console.log(chalk.gray(`      ${file.tokens} tokens`));
        });
      });
    } else {
      // Simple list view
      result.files.forEach((file, i) => {
        const num = chalk.gray(`${(i + 1).toString().padStart(2)}.`);
        const lang = chalk.cyan(`[${file.language || 'unknown'}]`.padEnd(12));
        const path = chalk.yellow(file.relativePath);
        const tokens = chalk.gray(`(${file.tokens} tokens)`);
        console.log(`  ${num} ${lang} ${path} ${tokens}`);
      });
    }
    
    if (result.totalFiles > result.files.length) {
      console.log(chalk.gray(`\n  ... and ${result.totalFiles - result.files.length} more files (use --limit to see more)`));
    }
  }
  
  // Summary
  console.log(chalk.gray('\n' + '═'.repeat(60)));
  console.log(chalk.blue('📊 Summary:'));
  
  if (result.symbols.length > 0 || options.showSymbols !== false) {
    console.log(`  • Symbols: ${chalk.yellow(result.totalSymbols)}`);
  }
  if (result.files.length > 0 || options.showFiles) {
    console.log(`  • Files: ${chalk.yellow(result.totalFiles)}`);
  }
  
  // Tips
  console.log(chalk.gray('\n💡 Tips:'));
  if (!searchPattern) {
    console.log(`  • Add a search pattern to filter results`);
  }
  console.log(`  • Use ${chalk.cyan('primordyn query <specific-symbol>')} for detailed context`);
  console.log(`  • Use ${chalk.cyan('--type <type>')} to filter by symbol type`);
  console.log(`  • Use ${chalk.cyan('--detailed')} for more information`);
  console.log(`  • Use ${chalk.cyan('--format json')} for machine-readable output`);
}