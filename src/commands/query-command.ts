import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { ContextRetriever } from '../retriever/index.js';
import chalk from 'chalk';

export const queryCommand = new Command('query')
  .description('Smart context retrieval for AI agents')
  .argument('<search-term>', 'Symbol, function, class, or search query')
  .option('--tokens <max>', 'Maximum tokens in response (default: 8000)', '8000')
  .option('--format <type>', 'Output format: ai, json, human (default: ai)', 'ai')
  .option('--depth <n>', 'Depth of context expansion (default: 1)', '1')
  .option('--include-tests', 'Include related test files')
  .option('--include-callers', 'Include files that use this symbol')
  .option('--show-graph', 'Show dependency graph (what it calls and what calls it)')
  .option('--languages <langs>', 'Filter by languages: ts,js,py,go,etc')
  .action(async (searchTerm: string, options) => {
    try {
      const db = new PrimordynDB();
      const retriever = new ContextRetriever(db);
      
      const fileTypes = options.languages ? options.languages.split(',').map((t: string) => t.trim()) : undefined;
      const maxTokens = parseInt(options.tokens);
      // const depth = parseInt(options.depth); // For future context expansion
      
      // First, try to find as a symbol
      const symbols = await retriever.findSymbol(searchTerm, { fileTypes });
      
      // Then get broader context
      const searchResult = await retriever.query(searchTerm, {
        maxTokens,
        includeContent: true,
        includeSymbols: true,
        includeImports: true,
        fileTypes,
        sortBy: 'relevance'
      });
      
      // Find usages if requested
      let usages: any[] = [];
      if (options.includeCallers && symbols.length > 0) {
        usages = await retriever.findUsages(searchTerm, { fileTypes, maxTokens: 2000 });
      }
      
      // Get dependency graph if requested
      let dependencyGraph = null;
      if (options.showGraph) {
        dependencyGraph = await retriever.getDependencyGraph(searchTerm);
      }
      
      // Combine results intelligently
      const result = {
        primarySymbol: symbols.length > 0 ? symbols[0] : null,
        allSymbols: symbols,
        files: searchResult.files,
        usages,
        dependencyGraph,
        totalTokens: searchResult.totalTokens,
        truncated: searchResult.truncated
      };
      
      // Handle different output formats
      switch (options.format) {
        case 'json':
          console.log(JSON.stringify(result, null, 2));
          break;
          
        case 'ai':
          outputAIFormat(searchTerm, result, options);
          break;
          
        default:
          outputHumanFormat(searchTerm, result, options);
      }
      
      db.close();
      
    } catch (error) {
      console.error(chalk.red('❌ Query failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

function outputAIFormat(searchTerm: string, result: any, options: any) {
  console.log(`# Context for: ${searchTerm}\n`);
  
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
    result.allSymbols.slice(1, 6).forEach((sym: any) => {
      console.log(`- **${sym.name}** (${sym.type}) - ${sym.filePath}:${sym.lineStart}`);
    });
    console.log();
  }
  
  // Files that contain or use this
  if (result.files.length > 0) {
    console.log(`### Found in Files`);
    result.files.slice(0, 5).forEach((file: any) => {
      console.log(`- **${file.relativePath}** (${file.tokens} tokens)`);
      
      // Show imports/exports if relevant
      if (file.imports && file.imports.length > 0) {
        const relevantImports = file.imports.filter((imp: string) => 
          imp.toLowerCase().includes(searchTerm.toLowerCase()) ||
          searchTerm.toLowerCase().includes(imp.toLowerCase())
        );
        if (relevantImports.length > 0) {
          console.log(`  - Imports: ${relevantImports.join(', ')}`);
        }
      }
      
      if (file.exports && file.exports.length > 0) {
        const relevantExports = file.exports.filter((exp: string) =>
          exp.toLowerCase().includes(searchTerm.toLowerCase())
        );
        if (relevantExports.length > 0) {
          console.log(`  - Exports: ${relevantExports.join(', ')}`);
        }
      }
      
      // Show symbols in this file
      if (file.symbols && file.symbols.length > 0) {
        const relevantSymbols = file.symbols.filter((sym: any) =>
          sym.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
        if (relevantSymbols.length > 0) {
          console.log(`  - Contains: ${relevantSymbols.map((s: any) => `${s.name} (${s.type})`).join(', ')}`);
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
      graph.calls.forEach((edge: any) => {
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
      graph.calledBy.forEach((edge: any) => {
        console.log(`- **${edge.from.name}** in ${edge.from.filePath}:${edge.from.line}`);
        console.log(`  Calls at line ${edge.line}`);
      });
      console.log();
    }
  }
  
  // Show where it's used (different from graph - this is text search based)
  if (result.usages && result.usages.length > 0) {
    console.log(`### Text References`);
    result.usages.slice(0, 10).forEach((file: any) => {
      console.log(`- **${file.relativePath}**`);
      if (file.metadata?.usageLines) {
        const lines = file.metadata.usageLines.slice(0, 3);
        console.log(`  Lines: ${lines.join(', ')}${file.metadata.usageLines.length > 3 ? '...' : ''}`);
      }
    });
    console.log();
  }
  
  // Test files if requested
  if (options.includeTests && result.files.some((f: any) => f.relativePath.includes('test'))) {
    console.log(`### Test Files`);
    result.files
      .filter((f: any) => f.relativePath.includes('test') || f.relativePath.includes('spec'))
      .slice(0, 3)
      .forEach((file: any) => {
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

function outputHumanFormat(searchTerm: string, result: any, _options: any) {
  console.log(chalk.blue(`🔍 Context for: "${searchTerm}"`));
  console.log(chalk.gray('━'.repeat(60)));
  
  if (!result.primarySymbol && result.files.length === 0) {
    console.log(chalk.yellow('No results found.'));
    console.log('\n' + chalk.blue('💡 Try:'));
    console.log('  • Different search terms');
    console.log('  • Check indexed files:', chalk.cyan('primordyn stats'));
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
    result.allSymbols.slice(1, 6).forEach((sym: any, index: number) => {
      console.log(chalk.blue(`   ${index + 2}. ${sym.name} (${sym.type})`));
      console.log(chalk.gray(`      ${sym.filePath}:${sym.lineStart}`));
    });
  }
  
  // Files
  if (result.files.length > 0) {
    console.log(chalk.green('\n📁 Found in Files:'));
    result.files.slice(0, 5).forEach((file: any, index: number) => {
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