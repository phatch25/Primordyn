import { Command } from 'commander';
import { DatabaseConnectionPool } from '../database/connection-pool.js';
import { ContextRetriever } from '../retriever/index.js';
import { AliasManager } from '../config/aliases.js';
import chalk from 'chalk';

export const listCommand = new Command('list')
  .description('Discover symbols and files with fuzzy search and aliases')
  .argument('[search]', 'Search pattern (fuzzy matching, supports @aliases)')
  .option('--type <type>', 'Filter by symbol type: function, class, interface, method, endpoint')
  .option('--limit <n>', 'Max results to show (default: 20)', '20')
  .option('--format <type>', 'Output format: text, json (default: text)', 'text')
  .action(async (searchPattern?: string, options?: any) => {
    try {
      const db = DatabaseConnectionPool.getConnection();
      
      // Check index exists
      const dbInfo = await db.getDatabaseInfo();
      if (dbInfo.fileCount === 0) {
        console.log(chalk.yellow('No index found. Run "primordyn index" first.'));
        process.exit(1);
      }
      
      const limit = parseInt(options?.limit || '20', 10);
      const retriever = new ContextRetriever(db);
      
      // Expand aliases (prefix with @)
      let expandedPattern = searchPattern;
      if (searchPattern?.startsWith('@')) {
        const aliasManager = new AliasManager(process.cwd());
        const aliasName = searchPattern.substring(1);
        const expanded = aliasManager.expandAlias(aliasName);
        if (expanded !== aliasName) {
          expandedPattern = expanded;
          console.log(chalk.gray(`Expanded @${aliasName} → ${expanded}\n`));
        }
      }
      
      // Search for symbols
      let symbols = [];
      if (expandedPattern) {
        // Try exact match first
        symbols = await retriever.findSymbol(expandedPattern, { 
          symbolType: options?.type 
        });
        
        // If no exact matches, use fuzzy search
        if (symbols.length === 0) {
          const suggestions = await retriever.getFuzzySuggestions(expandedPattern, 10);
          for (const suggestion of suggestions.slice(0, 3)) {
            const fuzzySymbols = await retriever.findSymbol(suggestion, { 
              symbolType: options?.type 
            });
            symbols.push(...fuzzySymbols.slice(0, 5));
          }
          
          if (symbols.length > 0) {
            console.log(chalk.yellow(`No exact match for "${expandedPattern}"`));
            console.log(chalk.gray(`Did you mean one of these?\n`));
          }
        }
      } else {
        // No pattern - list all symbols of type
        symbols = await retriever.listAllSymbols({ 
          symbolType: options?.type,
          limit: limit * 2
        });
      }
      
      // Limit results
      const totalFound = symbols.length;
      symbols = symbols.slice(0, limit);
      
      if (options?.format === 'json') {
        console.log(JSON.stringify({ symbols, total: totalFound }, null, 2));
        return;
      }
      
      // Text output - focused on discovery
      if (symbols.length === 0) {
        console.log(chalk.yellow('No symbols found'));
        if (searchPattern) {
          console.log(chalk.gray('\nTry:'));
          console.log(chalk.gray('  • A broader search term'));
          console.log(chalk.gray('  • Using an alias: @auth, @data, @api'));
          console.log(chalk.gray('  • Listing all: primordyn list'));
        }
        return;
      }
      
      // Group by type for better readability
      const byType = new Map<string, typeof symbols>();
      symbols.forEach(sym => {
        const type = sym.type || 'unknown';
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type)!.push(sym);
      });
      
      // Special handling for endpoints
      if (options?.type === 'endpoint' || searchPattern?.toLowerCase().includes('endpoint')) {
        // Filter out likely false positives (help files, docs, etc.)
        const realEndpoints = symbols.filter(sym => 
          !sym.filePath.includes('help-text') && 
          !sym.filePath.includes('README') &&
          !sym.filePath.includes('doc') &&
          // Only include if it looks like a real API route
          (sym.signature?.includes('app.') || 
           sym.signature?.includes('router.') || 
           sym.signature?.includes('@Get') || 
           sym.signature?.includes('@Post') ||
           sym.signature?.includes('route') ||
           sym.filePath.includes('controller') ||
           sym.filePath.includes('route') ||
           sym.filePath.includes('api'))
        );
        
        if (realEndpoints.length === 0) {
          console.log(chalk.yellow('No API endpoints found'));
          console.log(chalk.gray('Endpoints are detected from:'));
          console.log(chalk.gray('  • Express: app.get(), router.post()'));
          console.log(chalk.gray('  • Decorators: @Get(), @Post()'));
          console.log(chalk.gray('  • API route files'));
          return;
        }
        
        console.log(chalk.bold('API Endpoints:'));
        realEndpoints.forEach(sym => {
          // Extract HTTP method and route from signature if available
          const method = sym.signature?.match(/\.(get|post|put|delete|patch)\(/i)?.[1]?.toUpperCase() || 
                        sym.signature?.match(/@(Get|Post|Put|Delete|Patch)/i)?.[1]?.toUpperCase() || 'GET';
          const route = sym.signature?.match(/["']([^"']*\/[^"']*)["']/)?.[1] || `/${sym.name}`;
          console.log(chalk.cyan(`  ${method.padEnd(6)} ${route.padEnd(30)}`), chalk.gray(`${sym.filePath}:${sym.lineStart}`));
        });
      } else {
        // Regular symbol display
        const exactMatch = expandedPattern && symbols.some(s => 
          s.name.toLowerCase() === expandedPattern.toLowerCase()
        );
        
        if (exactMatch) {
          console.log(chalk.green('✓ Exact matches found:'));
        } else if (expandedPattern) {
          console.log(chalk.bold('Found related symbols:'));
        } else {
          console.log(chalk.bold('All symbols:'));
        }
        
        byType.forEach((syms, type) => {
          const pluralType = pluralize(type);
          console.log(chalk.cyan(`\n${pluralType} (${syms.length}):`));
          syms.forEach(sym => {
            const location = chalk.gray(`${sym.filePath}:${sym.lineStart}`);
            const isExact = expandedPattern && 
              sym.name.toLowerCase() === expandedPattern.toLowerCase();
            const name = isExact ? chalk.green(sym.name) : chalk.yellow(sym.name);
            console.log(`  ${name.padEnd(40)} ${location}`);
            if (sym.signature && sym.signature.length < 80) {
              console.log(chalk.gray(`    ${sym.signature}`));
            }
          });
        });
      }
      
      if (totalFound > symbols.length) {
        console.log(chalk.gray(`\n... ${totalFound - symbols.length} more results (use --limit ${limit * 2})`));
      }
      
      // Actionable next steps
      console.log(chalk.gray('\nNext steps:'));
      if (symbols.length > 0) {
        const first = symbols[0];
        console.log(chalk.gray(`  • primordyn query "${first.name}" - get full context`));
        console.log(chalk.gray(`  • primordyn query "${first.name}" --show-graph - see dependencies`));
      }
      
    } catch (error) {
      console.error(chalk.red('List failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  })
  .addHelpText('after', `
${chalk.bold('Purpose:')}
  Discover symbols when you don't know exact names. Uses fuzzy matching and
  semantic aliases to help AI assistants explore unfamiliar codebases.

${chalk.bold('Examples:')}
  ${chalk.gray('# Fuzzy search for authentication code')}
  $ primordyn list auth
  ${chalk.gray('→ Finds: authenticate, AuthService, authorization, etc.')}
  
  ${chalk.gray('# Use semantic alias for all auth-related code')}
  $ primordyn list @auth
  ${chalk.gray('→ Expands to: login, logout, session, token, auth')}
  
  ${chalk.gray('# Find all classes in the codebase')}
  $ primordyn list --type class
  
  ${chalk.gray('# Find API endpoints')}
  $ primordyn list --type endpoint
  ${chalk.gray('→ Shows: GET /api/users, POST /api/login, etc.')}
  
  ${chalk.gray('# Browse everything')}
  $ primordyn list

${chalk.bold('Features:')}
  • Fuzzy matching - finds "UserService" when searching "user srv"
  • Aliases - @auth expands to "login OR logout OR session OR token"
  • Smart grouping - results organized by type
  • Endpoint detection - special formatting for API routes

${chalk.bold('How it works:')}
  1. Exact matches shown first
  2. Falls back to fuzzy search if no exact matches
  3. Groups results by type for readability
  4. Suggests next steps for investigation

${chalk.bold('Tips:')}
  • Use aliases for semantic grouping (@api, @data, @auth)
  • Combine with 'query' for detailed navigation
  • Use --type to filter by symbol type`);

function pluralize(word: string): string {
  const irregulars: Record<string, string> = {
    'class': 'classes',
    'interface': 'interfaces',
    'property': 'properties'
  };
  
  if (irregulars[word]) {
    return irregulars[word];
  }
  
  // Handle regular plurals
  if (word.endsWith('s') || word.endsWith('sh') || word.endsWith('ch') || word.endsWith('x') || word.endsWith('z')) {
    return word + 'es';
  }
  
  if (word.endsWith('y') && !/[aeiou]y$/.test(word)) {
    return word.slice(0, -1) + 'ies';
  }
  
  return word + 's';
}