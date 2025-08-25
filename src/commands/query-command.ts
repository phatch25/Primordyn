import { Command } from 'commander';
import { DatabaseConnectionPool } from '../database/connection-pool.js';
import { ContextRetriever } from '../retriever/index.js';
import { QueryCommandOptions, QueryCommandResult, FileResult, DependencyGraph, ImpactAnalysis, GitHistory, RecentFileChanges, SymbolResult } from '../types/index.js';
import { validateTokenLimit, validateFormat, validateLanguages, validateDays, validateDepth, validateSearchTerm, ValidationError } from '../utils/validation.js';
import chalk from 'chalk';
import { withDefaults } from '../config/defaults.js';

export const queryCommand = new Command('query')
  .description('Get detailed context for a specific symbol or file')
  .argument('<target>', 'Exact symbol name or file path to retrieve')
  .option('--tokens <max>', 'Maximum tokens in response (default: 16000)', '16000')
  .option('--format <type>', 'Output format: ai, json, human (default: ai)', 'ai')
  .option('--depth <n>', 'Depth of context expansion (default: 1)', '1')
  .option('--include-tests', 'Include related test files')
  .option('--include-callers', 'Include files that use this symbol')
  .option('--show-graph', 'Show dependency graph (what it calls and what calls it)')
  .option('--impact', 'Show impact analysis (what breaks if you change this)')
  .option('--recent <days>', 'Show commits from last N days (default: 7)')
  .option('--blame', 'Show git blame (who last modified each line)')
  .option('--languages <langs>', 'Filter by languages: ts,js,py,go,etc')
  .option('--type <symbol-type>', 'Filter by symbol type: function,class,interface,method,etc')
  .option('--refresh', 'Force refresh of index before query')
  .addHelpText('after', `
${chalk.bold('Details:')}
  The query command retrieves detailed context about specific symbols or files,
  optimized for AI consumption. It provides exact matches with full implementation
  details, dependencies, and relationships.

${chalk.bold('Features:')}
  • Symbol-aware retrieval - Gets complete context for functions, classes, methods
  • Dependency tracking - Shows what the symbol uses and what uses it
  • Impact analysis - Identifies affected code if you change this symbol
  • Git integration - Shows recent changes and authorship
  • Token management - Respects AI model context limits
  • Multiple formats - AI-optimized, JSON, or human-readable output

${chalk.bold('Examples:')}
  ${chalk.gray('# Get context for a class')}
  $ primordyn query UserService
  
  ${chalk.gray('# Query a specific method')}
  $ primordyn query "Database.connect"
  
  ${chalk.gray('# Get context for a file')}
  $ primordyn query src/auth/login.ts
  
  ${chalk.gray('# Show dependency graph')}
  $ primordyn query UserService --show-graph
  
  ${chalk.gray('# Analyze change impact')}
  $ primordyn query AuthService --impact
  
  ${chalk.gray('# Include usage locations')}
  $ primordyn query Logger --include-callers
  
  ${chalk.gray('# Show recent changes (last 14 days)')}
  $ primordyn query UserService --recent 14
  
  ${chalk.gray('# Get JSON output for tools')}
  $ primordyn query UserService --format json
  
  ${chalk.gray('# Limit context size for smaller models')}
  $ primordyn query UserService --tokens 4000
  
  ${chalk.gray('# Filter by symbol type')}
  $ primordyn query render --type function

${chalk.bold('Output Formats:')}
  • ${chalk.cyan('ai')} (default) - Optimized for AI models with markdown formatting
  • ${chalk.cyan('json')} - Structured data for programmatic use
  • ${chalk.cyan('human')} - Readable format with syntax highlighting

${chalk.bold('Notes:')}
  • Use 'list' command first to discover available symbols
  • Query uses exact matching - for fuzzy search use 'list'
  • Token limit includes all context and dependencies
  • Impact analysis helps identify refactoring risks`)
  .action(async (searchTerm: string, options: QueryCommandOptions) => {
    try {
      // Apply smart defaults for better out-of-box experience
      const queryDefaults = withDefaults('query', {
        tokens: options.tokens || '16000',
        format: options.format || 'ai',
        depth: options.depth || '1',
        includeTests: options.includeTests || false,
        includeCallers: options.includeCallers || false,
        showGraph: options.showGraph || false,
        impact: options.impact || false
      });
      
      // Validate inputs with defaults applied
      const validatedSearchTerm = validateSearchTerm(searchTerm);
      const maxTokens = validateTokenLimit(queryDefaults.tokens);
      const format = validateFormat(queryDefaults.format);
      const depth = validateDepth(queryDefaults.depth);
      const fileTypes = options.languages ? validateLanguages(options.languages) : undefined;
      const days = options.recent ? validateDays(options.recent) : undefined;
      const symbolType = options.type;
      
      const db = DatabaseConnectionPool.getConnection();
      
      // Query command focuses on exact matches - no alias expansion
      // const expandedSearchTerm = validatedSearchTerm;
      
      // Check if index exists, build only if empty
      const dbInfo = await db.getDatabaseInfo();
      const isFirstIndex = dbInfo.fileCount === 0;
      
      if (isFirstIndex) {
        // First time - must build index
        const { Indexer } = await import('../indexer/index.js');
        const indexer = new Indexer(db);
        
        const spinner = (await import('ora')).default('Building index for the first time...').start();
        
        try {
          const stats = await indexer.index({ verbose: false, updateExisting: true });
          spinner.succeed(
            `Index built: ${stats.filesIndexed} files, ${stats.symbolsExtracted} symbols (${(stats.timeElapsed / 1000).toFixed(2)}s)`
          );
        } catch (error) {
          spinner.fail('Failed to build index');
          throw error;
        }
      } else if (options.refresh === true) {
        // Only refresh if explicitly requested with --refresh flag
        const { Indexer } = await import('../indexer/index.js');
        const indexer = new Indexer(db);
        
        const spinner = (await import('ora')).default('Refreshing index...').start();
        
        try {
          const stats = await indexer.index({ verbose: false, updateExisting: true });
          
          if (stats.filesIndexed > 0) {
            spinner.succeed(
              `Index refreshed: ${stats.filesIndexed} files updated, ${stats.symbolsExtracted} symbols (${(stats.timeElapsed / 1000).toFixed(2)}s)`
            );
          } else {
            spinner.succeed('Index is up to date');
          }
        } catch (error) {
          spinner.fail('Failed to refresh index');
          throw error;
        }
      }
      // Otherwise, use existing index as-is for maximum performance
      
      const retriever = new ContextRetriever(db);
      // const depth = parseInt(options.depth); // For future context expansion
      
      // Query command focuses on exact matches
      const searchTermToUse = validatedSearchTerm;
      
      // First, try to find as an exact symbol match
      const symbols = await retriever.findSymbol(searchTermToUse, { fileTypes, symbolType });
      
      // If exact symbol found, get its context; otherwise try as file path
      const searchResult = await retriever.query(searchTermToUse, {
        maxTokens,
        includeContent: true,
        includeSymbols: true,
        includeImports: true,
        fileTypes,
        symbolType,
        sortBy: 'relevance'
      });
      
      // Find usages if requested
      let usages: FileResult[] = [];
      if (options.includeCallers && symbols.length > 0) {
        usages = await retriever.findUsages(validatedSearchTerm, { fileTypes, maxTokens: 2000 });
      }
      
      // Get dependency graph if requested (using depth for call graph traversal)
      let dependencyGraph: DependencyGraph | null = null;
      if (options.showGraph) {
        dependencyGraph = await retriever.getDependencyGraphWithDepth(validatedSearchTerm, depth);
      }
      
      // Get impact analysis if requested
      let impactAnalysis: ImpactAnalysis | null = null;
      if (options.impact) {
        impactAnalysis = await retriever.getImpactAnalysis(validatedSearchTerm);
      }
      
      // Get git history if requested
      let gitHistory: GitHistory | null = null;
      if (options.recent || options.blame) {
        gitHistory = await retriever.getGitHistory(validatedSearchTerm);
      }
      
      // Get recent changes if requested
      let recentChanges: RecentFileChanges[] | null = null;
      if (days) {
        recentChanges = await retriever.getRecentChanges(days);
      }
      
      // Combine results intelligently
      const result: QueryCommandResult = {
        primarySymbol: symbols.length > 0 ? symbols[0] : null,
        allSymbols: symbols,
        files: searchResult.files,
        usages,
        dependencyGraph,
        impactAnalysis,
        gitHistory,
        recentChanges,
        totalTokens: searchResult.totalTokens,
        truncated: searchResult.truncated
      };
      
      // For query command, if no exact match found, suggest using list command
      let suggestions: string[] = [];
      if (!result.primarySymbol && result.files.length === 0) {
        // Don't do fuzzy matching in query - that's what list is for
        suggestions = [];
      }
      
      // Handle different output formats
      switch (format) {
        case 'json': {
          const jsonOutput = suggestions.length > 0 
            ? { ...result, suggestions }
            : result;
          console.log(JSON.stringify(jsonOutput, null, 2));
          break;
        }
          
        case 'ai':
          outputAIFormat(validatedSearchTerm, result, options, suggestions);
          break;
          
        default:
          outputHumanFormat(validatedSearchTerm, result, options, suggestions);
      }
      
      // Don't close - let connection pool manage it
      
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(chalk.red('❌ Validation error:'), error.message);
      } else {
        console.error(chalk.red('❌ Query failed:'), error instanceof Error ? error.message : error);
      }
      process.exit(1);
    }
  });

function outputAIFormat(searchTerm: string, result: QueryCommandResult, options: QueryCommandOptions, suggestions?: string[]) {
  console.log(`# Context for: ${searchTerm}\n`);
  
  // If no exact match found, suggest using list command
  if (!result.primarySymbol && result.files.length === 0) {
    console.log(`No exact match found for "${searchTerm}"\n`);
    console.log(`Try using the list command to search for similar items:\n`);
    console.log(`  primordyn list "${searchTerm}"\n`);
    return;
  }
  
  // Check if we're looking for endpoints
  const isEndpointSearch = options.type === 'endpoint' || 
    searchTerm.toLowerCase().includes('router') || 
    searchTerm.toLowerCase().includes('endpoint') ||
    searchTerm.toLowerCase().includes('@app') ||
    searchTerm.toLowerCase().includes('@router');
  
  // Collect all endpoint-like symbols from both allSymbols and file symbols
  const allEndpoints: SymbolResult[] = [];
  
  if (isEndpointSearch) {
    // Add from allSymbols
    result.allSymbols.forEach(sym => {
      if (sym.type === 'endpoint' || sym.type === 'decorator' || 
          sym.signature?.includes('@router') || sym.signature?.includes('@app')) {
        allEndpoints.push(sym);
      }
    });
    
    // Also extract from files if we have them
    result.files.forEach(file => {
      if (file.symbols) {
        file.symbols.forEach(sym => {
          if (sym.type === 'endpoint' || sym.type === 'decorator' ||
              sym.name?.includes('@router') || sym.name?.includes('@app')) {
            // Add file path and line info if not present
            allEndpoints.push({
              ...sym,
              filePath: sym.filePath || file.relativePath,
              lineStart: sym.lineStart || 0,
              lineEnd: sym.lineEnd || 0,
              id: sym.id || 0,
              type: sym.type || 'endpoint'
            } as SymbolResult);
          }
        });
      }
    });
  }
  
  if (isEndpointSearch && allEndpoints.length > 0) {
    // Show endpoints in a useful format
    console.log(`## API Endpoints\n`);
    const byFile: Record<string, typeof allEndpoints> = {};
    
    allEndpoints.forEach(sym => {
      const filePath = sym.filePath || 'unknown';
      if (!byFile[filePath]) byFile[filePath] = [];
      byFile[filePath].push(sym);
    });
    
    Object.entries(byFile).forEach(([file, syms]) => {
      console.log(`### ${file}\n`);
      syms.forEach(sym => {
        // Extract route from signature
        const routeMatch = sym.signature?.match(/["']([^"']+)["']/)?.[1] || 
                          sym.name?.match(/["']([^"']+)["']/)?.[1] || 'unknown';
        const methodMatch = sym.signature?.match(/(GET|POST|PUT|DELETE|PATCH|get|post|put|delete|patch)/i)?.[1]?.toUpperCase() || 
                           sym.name?.match(/(GET|POST|PUT|DELETE|PATCH|get|post|put|delete|patch)/i)?.[1]?.toUpperCase() || 'GET';
        const handler = sym.name?.replace(/@router\.(get|post|put|delete|patch)/i, '').trim() || sym.name || 'handler';
        console.log(`- \`${methodMatch} ${routeMatch}\` → ${handler} (line ${sym.lineStart || 0})`);
      });
      console.log();
    });
    
    console.log(`Total endpoints found: ${allEndpoints.length}\n`);
  } else if (result.primarySymbol) {
    // Show the primary symbol with its implementation
    const sym = result.primarySymbol;
    console.log(`## ${sym.name} (${sym.type})`);
    console.log(`📍 ${sym.filePath}:${sym.lineStart}\n`);
    
    if (sym.signature) {
      console.log(`\`\`\`typescript`);
      console.log(sym.signature);
      console.log(`\`\`\`\n`);
    }
    
    if (sym.content) {
      console.log(`### Implementation`);
      console.log(`\`\`\`typescript`);
      console.log(sym.content);
      console.log(`\`\`\`\n`);
    }
  }
  
  // Show additional matches if we didn't show endpoints
  if (!isEndpointSearch && result.allSymbols.length > 1) {
    console.log(`### Additional Matches`);
    result.allSymbols.slice(1, 6).forEach((sym) => {
      console.log(`- **${sym.name}** (${sym.type}) - ${sym.filePath}:${sym.lineStart}`);
    });
    console.log();
  }
  
  // Show files if no primary symbol was found and we're not in endpoint mode
  if (!result.primarySymbol && !isEndpointSearch && result.files.length > 0) {
    console.log(`### Found in Files`);
    result.files.slice(0, 10).forEach((file) => {
      console.log(`- **${file.relativePath}**`);
      
      // Show relevant symbols from this file
      if (file.symbols && file.symbols.length > 0) {
        const relevantSymbols = file.symbols.filter((sym) =>
          sym.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          sym.signature?.toLowerCase().includes(searchTerm.toLowerCase())
        );
        
        if (relevantSymbols.length > 0) {
          relevantSymbols.slice(0, 5).forEach((s) => {
            const lineInfo = s.lineStart ? `:${s.lineStart}` : '';
            console.log(`  - ${s.name} (${s.type})${lineInfo}`);
          });
          if (relevantSymbols.length > 5) {
            console.log(`  - ... and ${relevantSymbols.length - 5} more matches`);
          }
        } else {
          console.log(`  - ${file.tokens} tokens`);
        }
      }
      
      // If we have content and tokens available, show a preview
      if (file.content && options.tokens && parseInt(options.tokens) > 8000) {
        const preview = file.content.split('\n').slice(0, 20).join('\n');
        if (preview.length > 0) {
          console.log('  ```');
          console.log('  ' + preview.split('\n').slice(0, 10).join('\n  '));
          console.log('  ...');
          console.log('  ```');
        }
      }
    });
    console.log();
  }
  
  // Show dependency graph
  if (result.dependencyGraph) {
    const graph = result.dependencyGraph;
    
    if (graph.calls.length > 0) {
      console.log(`### Calls (Outgoing Dependencies)`);
      graph.calls.forEach((edge) => {
        const location = edge.to.filePath !== 'external' 
          ? `${edge.to.filePath}:${edge.to.line}` 
          : 'external';
        console.log(`- **${edge.to.name}** (${edge.callType}) - ${location}`);
        console.log(`  Called at line ${edge.line}`);
      });
      console.log();
    }
    
    if (graph.calledBy.length > 0) {
      console.log(`### Called By (Incoming Dependencies)`);
      graph.calledBy.forEach((edge) => {
        console.log(`- **${edge.from.name}** in ${edge.from.filePath}:${edge.from.line}`);
        console.log(`  Calls at line ${edge.line}`);
      });
      console.log();
    }
  }
  
  // Show impact analysis
  if (result.impactAnalysis) {
    const impact = result.impactAnalysis;
    
    console.log(`### 🎯 Impact Analysis`);
    console.log(`**Risk Level: ${impact.riskLevel}**\n`);
    
    console.log(`#### Impact Summary`);
    console.log(`- **Direct references:** ${impact.directReferences}`);
    console.log(`- **Files affected:** ${impact.filesAffected}`);
    console.log(`- **Symbols affected:** ${impact.symbolsAffected}`);
    console.log(`- **Tests affected:** ${impact.testsAffected}`);
    console.log();
    
    if (impact.riskFactors.length > 0) {
      console.log(`#### Risk Factors`);
      impact.riskFactors.forEach((factor: string) => {
        console.log(`- ${factor}`);
      });
      console.log();
    }
    
    if (impact.affectedFiles.length > 0) {
      console.log(`#### Most Affected Files`);
      impact.affectedFiles.slice(0, 10).forEach((file) => {
        const label = file.isTest ? '(test)' : '';
        console.log(`- **${file.path}** ${label}`);
        console.log(`  ${file.referenceCount} references at lines: ${file.lines.slice(0, 5).join(', ')}${file.lines.length > 5 ? '...' : ''}`);
      });
      console.log();
    }
    
    if (impact.suggestions.length > 0) {
      console.log(`#### Suggestions`);
      impact.suggestions.forEach((suggestion: string) => {
        console.log(`- ${suggestion}`);
      });
      console.log();
    }
  }
  
  // Show git history
  if (result.gitHistory) {
    const history = result.gitHistory;
    
    console.log(`### 📜 Git History`);
    console.log(`**Last modified:** ${history.lastModified.toLocaleDateString()}`);
    console.log(`**First seen:** ${history.firstSeen.toLocaleDateString()}`);
    console.log(`**Total commits:** ${history.totalCommits}`);
    console.log(`**Unique authors:** ${history.uniqueAuthors.length}`);
    console.log();
    
    if (history.changeFrequency) {
      console.log(`#### Change Frequency`);
      console.log(`- Last 7 days: ${history.changeFrequency.last7Days} commits`);
      console.log(`- Last 30 days: ${history.changeFrequency.last30Days} commits`);
      console.log(`- Last 90 days: ${history.changeFrequency.last90Days} commits`);
      console.log();
    }
    
    if (history.recentCommits.length > 0) {
      console.log(`#### Recent Commits`);
      history.recentCommits.slice(0, 5).forEach((commit) => {
        const date = new Date(commit.date).toLocaleDateString();
        console.log(`- **${commit.hash.substring(0, 7)}** - ${commit.message}`);
        console.log(`  ${commit.author} on ${date}`);
      });
      console.log();
    }
    
    if (options.blame && history.blame && history.blame.length > 0) {
      console.log(`#### Git Blame`);
      history.blame.slice(0, 10).forEach((blame) => {
        const date = new Date(blame.commit.date).toLocaleDateString();
        console.log(`- Line ${blame.line}: ${blame.commit.author} (${date})`);
        console.log(`  \`${blame.content.trim()}\``);
      });
      console.log();
    }
    
    if (history.relatedFiles && history.relatedFiles.length > 0) {
      console.log(`#### Files Often Changed Together`);
      history.relatedFiles.slice(0, 5).forEach((file) => {
        console.log(`- **${file.path}** (${file.coChangeCount} co-changes)`);
      });
      console.log();
    }
  }
  
  // Show recent changes across the codebase
  if (result.recentChanges && result.recentChanges.length > 0) {
    console.log(`### 🔄 Recent Changes (last ${options.recent || 7} days)`);
    result.recentChanges.slice(0, 10).forEach((item) => {
      console.log(`- **${item.file}** (${item.commits.length} commits)`);
      if (item.commits[0]) {
        const lastCommit = item.commits[0];
        console.log(`  Last: "${lastCommit.message}" by ${lastCommit.author}`);
      }
    });
    console.log();
  }
  
  // Show where it's used (different from graph - this is text search based)
  if (result.usages && result.usages.length > 0) {
    console.log(`### Text References`);
    result.usages.slice(0, 10).forEach((file) => {
      console.log(`- **${file.relativePath}**`);
      if (file.metadata && typeof file.metadata === 'object' && 'usageLines' in file.metadata) {
        const usageLines = (file.metadata as { usageLines?: number[] }).usageLines;
        if (Array.isArray(usageLines)) {
          const lines = usageLines.slice(0, 3);
          console.log(`  Lines: ${lines.join(', ')}${usageLines.length > 3 ? '...' : ''}`);
        }
      }
    });
    console.log();
  }
  
  // Test files if requested
  if (options.includeTests && result.files.some((f) => f.relativePath.includes('test'))) {
    console.log(`### Test Files`);
    result.files
      .filter((f) => f.relativePath.includes('test') || f.relativePath.includes('spec'))
      .slice(0, 3)
      .forEach((file) => {
        console.log(`- **${file.relativePath}**`);
      });
    console.log();
  }
  
  // Token usage
  console.log(`### Token Usage`);
  console.log(`- Total tokens: ${result.totalTokens}`);
  if (result.truncated) {
    console.log(`- ⚠️ Results truncated (increase --tokens for more context)`);
  }
}

function outputHumanFormat(searchTerm: string, result: QueryCommandResult, _options: QueryCommandOptions, suggestions?: string[]) {
  console.log(chalk.blue(`🔍 Context for: "${searchTerm}"`));
  console.log(chalk.gray('═'.repeat(60)));
  
  if (!result.primarySymbol && result.files.length === 0) {
    console.log(chalk.yellow('No results found.'));
    
    if (!suggestions || suggestions.length === 0) {
      console.log('\n' + chalk.green('💡 Try the list command:'));
      console.log(chalk.cyan(`  primordyn list "${searchTerm}"`));
    } else {
      console.log('\n' + chalk.blue('💡 Try:'));
      console.log('  • Different search terms');
      console.log('  • Check indexed files:', chalk.cyan('primordyn stats'));
    }
    return;
  }
  
  // Primary symbol
  if (result.primarySymbol) {
    const sym = result.primarySymbol;
    console.log(chalk.green('\n🎯 Primary Match:'));
    console.log(chalk.blue(`   ${sym.name} (${sym.type})`));
    console.log(chalk.gray(`   📍 ${sym.filePath}:${sym.lineStart}-${sym.lineEnd}`));
    
    if (sym.signature) {
      console.log(chalk.gray(`   Signature: ${sym.signature.substring(0, 100)}${sym.signature.length > 100 ? '...' : ''}`));
    }
    
    if (sym.content) {
      console.log(chalk.gray('\n   Implementation:'));
      const lines = sym.content.split('\n').slice(0, 10);
      lines.forEach((line: string) => console.log(chalk.gray(`     ${line}`)));
      if (sym.content.split('\n').length > 10) {
        console.log(chalk.gray('     ... (truncated)'));
      }
    }
  }
  
  // Other symbols
  if (result.allSymbols.length > 1) {
    console.log(chalk.green('\n🏷️ Other Matches:'));
    result.allSymbols.slice(1, 6).forEach((sym, index: number) => {
      console.log(chalk.blue(`   ${index + 2}. ${sym.name} (${sym.type})`));
      console.log(chalk.gray(`      ${sym.filePath}:${sym.lineStart}`));
    });
  }
  
  // Files
  if (result.files.length > 0) {
    console.log(chalk.green('\n📁 Found in Files:'));
    result.files.slice(0, 5).forEach((file, index: number) => {
      console.log(chalk.blue(`   ${index + 1}. ${file.relativePath}`));
      console.log(chalk.gray(`      ${file.language || 'unknown'} | ${file.tokens} tokens`));
    });
  }
  
  // Summary
  console.log(chalk.gray('\n' + '═'.repeat(60)));
  console.log(chalk.blue('📊 Summary:'));
  console.log(`  • Symbols found: ${chalk.yellow(result.allSymbols.length)}`);
  console.log(`  • Files found: ${chalk.yellow(result.files.length)}`);
  console.log(`  • Total tokens: ${chalk.yellow(result.totalTokens.toLocaleString())}`);
  
  if (result.truncated) {
    console.log(chalk.yellow('\n  ⚠️ Results truncated due to token limit'));
  }
  
  console.log(chalk.gray('\n💡 Tips:'));
  console.log(`  • Use ${chalk.cyan('--format ai')} for AI-optimized markdown output`);
  console.log(`  • Use ${chalk.cyan('--include-tests')} to include test files`);
  console.log(`  • Use ${chalk.cyan('--include-callers')} to find usage locations`);
}