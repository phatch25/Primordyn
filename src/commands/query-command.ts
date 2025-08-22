import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { ContextRetriever } from '../retriever/index.js';
import { QueryCommandOptions, QueryCommandResult, FileResult, DependencyGraph, ImpactAnalysis, GitHistory, RecentFileChanges } from '../types/index.js';
import { validateTokenLimit, validateFormat, validateLanguages, validateDays, validateDepth, validateSearchTerm, ValidationError } from '../utils/validation.js';
import { AliasManager } from '../config/aliases.js';
import chalk from 'chalk';

export const queryCommand = new Command('query')
  .description('Smart context retrieval for AI agents')
  .argument('<search-term>', 'Symbol, function, class, or search query')
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
  .option('--no-refresh', 'Skip auto-refresh of index (use existing index as-is)')
  .action(async (searchTerm: string, options: QueryCommandOptions) => {
    try {
      // Validate inputs
      const validatedSearchTerm = validateSearchTerm(searchTerm);
      const maxTokens = validateTokenLimit(options.tokens);
      const format = validateFormat(options.format);
      const depth = validateDepth(options.depth);
      const fileTypes = options.languages ? validateLanguages(options.languages) : undefined;
      const days = options.recent ? validateDays(options.recent) : undefined;
      const symbolType = options.type;
      
      const db = new PrimordynDB();
      
      // Expand search term using aliases
      const aliasManager = new AliasManager(process.cwd());
      const expandedSearchTerm = aliasManager.expandAlias(validatedSearchTerm);
      const isAliasExpanded = expandedSearchTerm !== validatedSearchTerm;
      
      if (isAliasExpanded && process.env.PRIMORDYN_VERBOSE === 'true') {
        console.log(chalk.gray(`Expanded alias "${validatedSearchTerm}" to: ${expandedSearchTerm}`));
      }
      
      // Auto-refresh index unless --no-refresh is specified
      // This is fast (sub-second) for already-indexed repos due to hash checking
      if (options.refresh !== false) {  // Commander sets refresh to false when --no-refresh is used
        const { Indexer } = await import('../indexer/index.js');
        const indexer = new Indexer(db);
        
        const dbInfo = await db.getDatabaseInfo();
        const isFirstIndex = dbInfo.fileCount === 0;
        
        // Only show spinner for first index or if verbose mode requested
        const showProgress = isFirstIndex || process.env.PRIMORDYN_VERBOSE === 'true';
        
        if (showProgress) {
          const spinner = (await import('ora')).default(
            isFirstIndex ? 'Building index for the first time...' : 'Refreshing index...'
          ).start();
          
          try {
            const stats = await indexer.index({ verbose: false, updateExisting: true });
            
            if (stats.filesIndexed > 0 || isFirstIndex) {
              spinner.succeed(
                `Index ${isFirstIndex ? 'built' : 'refreshed'}: ${stats.filesIndexed} files, ${stats.symbolsExtracted} symbols (${(stats.timeElapsed / 1000).toFixed(2)}s)`
              );
            } else {
              spinner.stop(); // Silent when no changes
            }
          } catch (error) {
            spinner.fail('Failed to update index');
            throw error;
          }
        } else {
          // Silent refresh - the magic happens here
          // This typically takes <50ms when no changes, <200ms with a few file changes
          await indexer.index({ verbose: false, updateExisting: true });
        }
      } else {
        // Check if index exists when --no-refresh is used
        const dbInfo = await db.getDatabaseInfo();
        if (dbInfo.fileCount === 0) {
          console.log(chalk.yellow('⚠️  No index found. Run without --no-refresh to build index.'));
          process.exit(1);
        }
      }
      
      const retriever = new ContextRetriever(db);
      // const depth = parseInt(options.depth); // For future context expansion
      
      // Use expanded search term for queries
      const searchTermToUse = expandedSearchTerm;
      
      // First, try to find as a symbol (use original term for exact symbol match)
      const symbols = await retriever.findSymbol(validatedSearchTerm, { fileTypes, symbolType });
      
      // Then get broader context (use expanded term for broader search)
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
      
      // If no results found, try to get fuzzy suggestions
      let suggestions: string[] = [];
      if (!result.primarySymbol && result.files.length === 0) {
        suggestions = await retriever.getFuzzySuggestions(validatedSearchTerm, 5);
      }
      
      // Handle different output formats
      switch (format) {
        case 'json':
          const jsonOutput = suggestions.length > 0 
            ? { ...result, suggestions }
            : result;
          console.log(JSON.stringify(jsonOutput, null, 2));
          break;
          
        case 'ai':
          outputAIFormat(validatedSearchTerm, result, options, suggestions);
          break;
          
        default:
          outputHumanFormat(validatedSearchTerm, result, options, suggestions);
      }
      
      db.close();
      
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
  
  // If no results but have suggestions
  if (!result.primarySymbol && result.files.length === 0 && suggestions && suggestions.length > 0) {
    console.log(`No exact matches found. Did you mean one of these?\n`);
    suggestions.forEach(s => console.log(`  • ${s}`));
    console.log(`\nTry: primordyn query "${suggestions[0]}"\n`);
    return;
  }
  
  // Primary symbol if found
  if (result.primarySymbol) {
    const sym = result.primarySymbol;
    console.log(`## ${sym.name} (${sym.type})`);
    console.log(`📍 ${sym.filePath}:${sym.lineStart}-${sym.lineEnd}\n`);
    
    if (sym.signature) {
      console.log(`### Signature`);
      console.log(`\`\`\`typescript`);
      console.log(sym.signature);
      console.log(`\`\`\`\n`);
    }
    
    // Show documentation if available
    if ((sym as any).documentation) {
      console.log(`### Documentation`);
      console.log((sym as any).documentation);
      console.log();
    }
    
    if (sym.content) {
      console.log(`### Implementation`);
      console.log(`\`\`\`typescript`);
      console.log(sym.content);
      console.log(`\`\`\`\n`);
    }
  }
  
  // Related symbols
  if (result.allSymbols.length > 1) {
    console.log(`### Related Symbols`);
    result.allSymbols.slice(1, 6).forEach((sym) => {
      console.log(`- **${sym.name}** (${sym.type}) - ${sym.filePath}:${sym.lineStart}`);
    });
    console.log();
  }
  
  // Files that contain or use this
  if (result.files.length > 0) {
    console.log(`### Found in Files`);
    result.files.slice(0, 5).forEach((file) => {
      console.log(`- **${file.relativePath}** (${file.tokens} tokens)`);
      
      // Always show imports/exports for context, not just relevant ones
      if (file.imports && file.imports.length > 0) {
        console.log(`  - Imports: ${file.imports.slice(0, 5).join(', ')}${file.imports.length > 5 ? ` (+${file.imports.length - 5} more)` : ''}`);
      }
      
      if (file.exports && file.exports.length > 0) {
        console.log(`  - Exports: ${file.exports.slice(0, 5).join(', ')}${file.exports.length > 5 ? ` (+${file.exports.length - 5} more)` : ''}`);
      }
      
      // Show symbols in this file
      if (file.symbols && file.symbols.length > 0) {
        const relevantSymbols = file.symbols.filter((sym) =>
          sym.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
        if (relevantSymbols.length > 0) {
          console.log(`  - Contains: ${relevantSymbols.map((s) => `${s.name} (${s.type})`).join(', ')}`);
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
  console.log(chalk.gray('━'.repeat(60)));
  
  if (!result.primarySymbol && result.files.length === 0) {
    console.log(chalk.yellow('No results found.'));
    
    if (suggestions && suggestions.length > 0) {
      console.log('\n' + chalk.green('💡 Did you mean:'));
      suggestions.forEach(s => {
        console.log(chalk.cyan(`  • ${s}`));
      });
      console.log('\n' + chalk.gray(`Try: primordyn query "${suggestions[0]}"`));
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
  console.log(chalk.gray('\n━'.repeat(60)));
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