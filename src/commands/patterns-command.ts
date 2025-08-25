import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import chalk from 'chalk';
import ora from 'ora';

interface SimilarSymbol {
  name: string;
  type: string;
  file: string;
  line: number;
  similarity: number;
  sharedPatterns: string[];
}

export const patternsCommand =
  new Command('patterns')
    .description('Find similar code patterns and structures')
    .argument('<symbol>', 'Symbol to find similar patterns for')
    .option('--threshold <number>', 'Similarity threshold (0-1, default: 0.6)', parseFloat, 0.6)
    .option('--max-results <number>', 'Maximum results to show (default: 10)', parseInt, 10)
    .option('--show-patterns', 'Show the matching patterns')
    .action(async (symbolName: string, options) => {
      const spinner = ora('Analyzing code patterns...').start();
      
      try {
        const db = new PrimordynDB();
        // const projectRoot = process.cwd();
        // const dbPath = join(projectRoot, '.primordyn', 'context.db');
        
        const dbInfo = await db.getDatabaseInfo();
        if (dbInfo.fileCount === 0) {
          spinner.fail(chalk.red('No index found. Run "primordyn index" first.'));
          process.exit(1);
        }
        
        // Find the target symbol
        const targetStmt = db.getDatabase().prepare(`
          SELECT s.*, f.relative_path, f.path as file_path, f.content as file_content
          FROM symbols s
          JOIN files f ON s.file_id = f.id
          WHERE s.name = ?
          LIMIT 1
        `);
        const targetSymbol = targetStmt.get(symbolName) as any;
        
        if (!targetSymbol) {
          spinner.fail(chalk.red(`Symbol "${symbolName}" not found`));
          db.close();
          process.exit(1);
        }
        
        // Extract patterns from target symbol
        const targetPatterns = extractPatterns(targetSymbol, db);
        
        if (targetPatterns.size === 0) {
          spinner.fail(chalk.yellow('Could not extract patterns from target symbol'));
          db.close();
          return;
        }
        
        // Find all symbols of the same type
        const candidatesStmt = db.getDatabase().prepare(`
          SELECT s.*, f.relative_path, f.path as file_path, f.content as file_content
          FROM symbols s
          JOIN files f ON s.file_id = f.id
          WHERE s.type = ?
            AND s.id != ?
        `);
        
        const candidates = candidatesStmt.all(targetSymbol.type, targetSymbol.id) as any[];
        
        // Calculate similarity for each candidate
        const similarities: SimilarSymbol[] = [];
        
        for (const candidate of candidates) {
          const candidatePatterns = extractPatterns(candidate, db);
          const similarity = calculateSimilarity(targetPatterns, candidatePatterns);
          
          if (similarity >= options.threshold) {
            const sharedPatterns = findSharedPatterns(targetPatterns, candidatePatterns);
            
            similarities.push({
              name: candidate.name,
              type: candidate.type,
              file: candidate.relative_path,
              line: candidate.line_start,
              similarity,
              sharedPatterns
            });
          }
        }
        
        // Sort by similarity
        similarities.sort((a, b) => b.similarity - a.similarity);
        
        spinner.stop();
        
        if (similarities.length === 0) {
          console.log(chalk.yellow(`\nNo similar patterns found for ${symbolName} (threshold: ${options.threshold})`));
          db.close();
          return;
        }
        
        console.log(chalk.cyan(`\n🔍 Found ${similarities.length} similar ${targetSymbol.type}s to ${chalk.white(symbolName)}:\n`));
        
        for (const similar of similarities.slice(0, options.maxResults)) {
          const percentage = Math.round(similar.similarity * 100);
          const similarityColor = 
            percentage >= 80 ? chalk.green :
            percentage >= 60 ? chalk.yellow :
            chalk.gray;
          
          console.log(`  ${similarityColor('●')} ${similar.file}:${similar.line} - ${chalk.white(similar.name)} ${similarityColor(`${percentage}% similar`)}`);
          
          if (options.showPatterns && similar.sharedPatterns.length > 0) {
            console.log(chalk.gray('     Shared patterns:'));
            for (const pattern of similar.sharedPatterns.slice(0, 5)) {
              console.log(chalk.gray(`       • ${pattern}`));
            }
          }
        }
        
        // Pattern analysis
        const allSharedPatterns = new Map<string, number>();
        for (const sim of similarities) {
          for (const pattern of sim.sharedPatterns) {
            allSharedPatterns.set(pattern, (allSharedPatterns.get(pattern) || 0) + 1);
          }
        }
        
        const commonPatterns = Array.from(allSharedPatterns.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        
        if (commonPatterns.length > 0) {
          console.log(chalk.cyan('\n📊 COMMON PATTERNS:'));
          for (const [pattern, count] of commonPatterns) {
            const percentage = Math.round((count / similarities.length) * 100);
            console.log(`  • ${pattern} (${percentage}% of similar symbols)`);
          }
        }
        
        // Refactoring opportunities
        const highSimilarity = similarities.filter(s => s.similarity >= 0.8);
        
        if (highSimilarity.length >= 3) {
          console.log(chalk.yellow('\n💡 REFACTORING OPPORTUNITIES:'));
          console.log(`  • ${chalk.yellow(highSimilarity.length)} ${targetSymbol.type}s are >80% similar`);
          console.log(`  • Consider extracting common functionality to a base class or utility`);
          
          // Check if they're in different files
          const files = new Set(highSimilarity.map(s => s.file));
          if (files.size > 1) {
            console.log(`  • Similar code spans ${files.size} files - strong candidate for shared module`);
          }
        }
        
        db.close();
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        process.exit(1);
      }
    });

function extractPatterns(symbol: any, db: PrimordynDB): Set<string> {
  const patterns = new Set<string>();
  
  // Type pattern
  patterns.add(`type:${symbol.type}`);
  
  // Extract content from file if available
  let content = symbol.signature || '';
  if (symbol.file_content && symbol.line_start && symbol.line_end) {
    const lines = symbol.file_content.split('\n');
    content = lines.slice(symbol.line_start - 1, symbol.line_end).join('\n');
  }
  
  // Parameter patterns (for functions)
  if (symbol.type === 'function' || symbol.type === 'method') {
    const paramMatch = content.match(/\(([^)]*)\)/);
    if (paramMatch) {
      const params = paramMatch[1].split(',').map((p: string) => p.trim()).filter((p: string) => p);
      patterns.add(`param_count:${params.length}`);
      
      // Parameter type patterns
      for (const param of params) {
        if (param.includes(':')) {
          const type = param.split(':')[1].trim().split('=')[0].trim();
          patterns.add(`param_type:${type}`);
        }
      }
    }
  }
  
  // Return type pattern
  const returnMatch = content.match(/\):\s*([^{]+)\{/);
  if (returnMatch) {
    patterns.add(`return:${returnMatch[1].trim()}`);
  }
  
  // Get symbols this one calls
  const callsStmt = db.getDatabase().prepare(`
    SELECT s.name, s.type
    FROM call_graph cg
    JOIN symbols s ON cg.callee_symbol_id = s.id
    WHERE cg.caller_symbol_id = ?
  `);
  
  const calls = callsStmt.all(symbol.id) as any[];
  for (const call of calls) {
    patterns.add(`calls:${call.type}`);
    
    // Common method names
    if (['get', 'set', 'update', 'delete', 'create', 'find', 'save'].some(p => call.name.toLowerCase().includes(p))) {
      patterns.add(`crud_op:${call.name.toLowerCase().match(/(get|set|update|delete|create|find|save)/)?.[0]}`);
    }
  }
  
  // Control flow patterns
  if (content) {
    if (content.includes('if')) patterns.add('flow:conditional');
    if (content.includes('for') || content.includes('while')) patterns.add('flow:loop');
    if (content.includes('try')) patterns.add('flow:error_handling');
    if (content.includes('async') || content.includes('await')) patterns.add('flow:async');
    if (content.includes('return')) patterns.add('flow:returns');
    
    // Common patterns
    if (content.includes('console.log') || content.includes('logger')) patterns.add('pattern:logging');
    if (content.includes('validate') || content.includes('validation')) patterns.add('pattern:validation');
    if (content.includes('cache')) patterns.add('pattern:caching');
    if (content.includes('query') || content.includes('SELECT')) patterns.add('pattern:database');
  }
  
  // Size pattern
  const lines = (symbol.line_end - symbol.line_start + 1);
  if (lines < 10) patterns.add('size:small');
  else if (lines < 50) patterns.add('size:medium');
  else patterns.add('size:large');
  
  return patterns;
}

function calculateSimilarity(patterns1: Set<string>, patterns2: Set<string>): number {
  const intersection = new Set([...patterns1].filter(x => patterns2.has(x)));
  const union = new Set([...patterns1, ...patterns2]);
  
  if (union.size === 0) return 0;
  
  // Jaccard similarity with weight for certain patterns
  let weightedIntersection = 0;
  let weightedUnion = 0;
  
  for (const pattern of union) {
    const weight = getPatternWeight(pattern);
    weightedUnion += weight;
    
    if (intersection.has(pattern)) {
      weightedIntersection += weight;
    }
  }
  
  return weightedIntersection / weightedUnion;
}

function getPatternWeight(pattern: string): number {
  // Give more weight to structural patterns
  if (pattern.startsWith('param_count:')) return 2;
  if (pattern.startsWith('return:')) return 2;
  if (pattern.startsWith('calls:')) return 1.5;
  if (pattern.startsWith('pattern:')) return 1.5;
  return 1;
}

function findSharedPatterns(patterns1: Set<string>, patterns2: Set<string>): string[] {
  return [...patterns1].filter(x => patterns2.has(x));
}