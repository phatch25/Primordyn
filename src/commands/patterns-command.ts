import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import chalk from 'chalk';
import ora from 'ora';
import { PatternMatcher, ExtractedPatterns } from '../utils/pattern-matcher.js';
import { getHelpText } from '../utils/help-texts.js';
import type { PatternTargetSymbol, PatternCandidate } from '../types/database.js';

interface SimilarSymbol {
  name: string;
  type: string;
  file: string;
  line: number;
  similarity: number;
  sharedPatterns: string[];
  categoryScores?: Record<string, number>;
}

export const patternsCommand =
  new Command('patterns')
    .description('Find similar code patterns and structures')
    .argument('<symbol>', 'Symbol to find similar patterns for')
    .option('--threshold <number>', 'Similarity threshold (0-1, default: 0.6)', parseFloat, 0.6)
    .option('--max-results <number>', 'Maximum results to show (default: 10)', parseInt, 10)
    .option('--show-patterns', 'Show the matching patterns')
    .option('--pattern <pattern>', 'Search for specific pattern (e.g., "constructor", "async", "crud:*")')
    .option('--category <category>', 'Focus on pattern category: structural, signature, behavioral, semantic')
    .option('--verbose', 'Show detailed pattern analysis')
    .addHelpText('after', getHelpText('patterns'))
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
        const targetSymbol = targetStmt.get(symbolName) as PatternTargetSymbol | undefined;
        
        if (!targetSymbol) {
          spinner.fail(chalk.red(`Symbol "${symbolName}" not found`));
          db.close();
          process.exit(1);
        }
        
        // Extract content for pattern analysis
        let targetContent = '';
        if (targetSymbol.file_content && targetSymbol.line_start && targetSymbol.line_end) {
          const lines = targetSymbol.file_content.split('\n');
          targetContent = lines.slice(targetSymbol.line_start - 1, targetSymbol.line_end).join('\n');
        }
        
        // Extract patterns using enhanced matcher
        const targetPatterns = PatternMatcher.extractPatterns(targetSymbol, targetContent);
        
        if (targetPatterns.patterns.size === 0) {
          spinner.fail(chalk.yellow('Could not extract patterns from target symbol'));
          db.close();
          return;
        }
        
        // Filter by specific pattern if requested
        if (options.pattern) {
          const patternLower = options.pattern.toLowerCase();
          const filteredPatterns = new Set<string>();
          const filteredWeighted = new Map<string, number>();
          const filteredCategories = new Map<string, Set<string>>();
          
          targetPatterns.patterns.forEach(p => {
            if (p.toLowerCase().includes(patternLower) || 
                (patternLower.endsWith('*') && p.toLowerCase().startsWith(patternLower.slice(0, -1)))) {
              filteredPatterns.add(p);
              if (targetPatterns.weighted.has(p)) {
                filteredWeighted.set(p, targetPatterns.weighted.get(p)!);
              }
              // Re-categorize
              targetPatterns.categories.forEach((catPatterns, cat) => {
                if (catPatterns.has(p)) {
                  if (!filteredCategories.has(cat)) {
                    filteredCategories.set(cat, new Set());
                  }
                  filteredCategories.get(cat)!.add(p);
                }
              });
            }
          });
          
          if (filteredPatterns.size === 0) {
            spinner.fail(chalk.yellow(`No patterns matching "${options.pattern}" found in ${symbolName}`));
            db.close();
            return;
          }
          
          targetPatterns.patterns = filteredPatterns;
          targetPatterns.weighted = filteredWeighted;
          targetPatterns.categories = filteredCategories;
        }
        
        // Find candidate symbols - if pattern specified, search more broadly
        let candidatesStmt;
        let candidates;
        
        if (options.pattern && options.pattern.includes('constructor')) {
          // Special handling for constructor pattern - search methods named 'constructor'
          candidatesStmt = db.getDatabase().prepare(`
            SELECT s.*, f.relative_path, f.path as file_path, f.content as file_content
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE (s.name = 'constructor' OR s.type = 'method')
              AND s.id != ?
          `);
          candidates = candidatesStmt.all(targetSymbol.id) as PatternCandidate[];
        } else if (options.pattern) {
          // Broader search when pattern specified
          candidatesStmt = db.getDatabase().prepare(`
            SELECT s.*, f.relative_path, f.path as file_path, f.content as file_content
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE s.id != ?
          `);
          candidates = candidatesStmt.all(targetSymbol.id) as PatternCandidate[];
        } else {
          // Default: same type only
          candidatesStmt = db.getDatabase().prepare(`
            SELECT s.*, f.relative_path, f.path as file_path, f.content as file_content
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE s.type = ?
              AND s.id != ?
          `);
          candidates = candidatesStmt.all(targetSymbol.type, targetSymbol.id) as PatternCandidate[];
        }
        
        // Calculate similarity for each candidate
        const similarities: SimilarSymbol[] = [];
        
        for (const candidate of candidates) {
          // Extract content for candidate
          let candidateContent = '';
          if (candidate.file_content && candidate.line_start && candidate.line_end) {
            const lines = candidate.file_content.split('\n');
            candidateContent = lines.slice(candidate.line_start - 1, candidate.line_end).join('\n');
          }
          
          const candidatePatterns = PatternMatcher.extractPatterns(candidate, candidateContent);
          
          // Filter candidate patterns by category if specified
          if (options.category) {
            const catPatterns = candidatePatterns.categories.get(options.category);
            if (!catPatterns || catPatterns.size === 0) continue;
          }
          
          const similarity = PatternMatcher.calculateSimilarity(targetPatterns, candidatePatterns);
          
          if (similarity >= options.threshold) {
            const sharedPatterns = findSharedPatterns(targetPatterns.patterns, candidatePatterns.patterns);
            
            // Calculate category scores if verbose
            const categoryScores: Record<string, number> = {};
            if (options.verbose) {
              ['structural', 'signature', 'behavioral', 'semantic'].forEach(cat => {
                const catTarget = { 
                  patterns: targetPatterns.categories.get(cat) || new Set(),
                  weighted: targetPatterns.weighted,
                  categories: new Map([[cat, targetPatterns.categories.get(cat) || new Set()]])
                };
                const catCandidate = {
                  patterns: candidatePatterns.categories.get(cat) || new Set(),
                  weighted: candidatePatterns.weighted,
                  categories: new Map([[cat, candidatePatterns.categories.get(cat) || new Set()]])
                };
                if (catTarget.patterns.size > 0 || catCandidate.patterns.size > 0) {
                  categoryScores[cat] = PatternMatcher.calculateSimilarity(catTarget as ExtractedPatterns, catCandidate as ExtractedPatterns);
                }
              });
            }
            
            similarities.push({
              name: candidate.name,
              type: candidate.type,
              file: candidate.relative_path,
              line: candidate.line_start,
              similarity,
              sharedPatterns,
              categoryScores
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
          
          if (options.verbose && similar.categoryScores) {
            console.log(chalk.gray('     Category breakdown:'));
            Object.entries(similar.categoryScores).forEach(([cat, score]) => {
              if (score > 0) {
                const percentage = Math.round(score * 100);
                console.log(chalk.gray(`       ${cat}: ${percentage}%`));
              }
            });
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
            const [category, value] = pattern.split(':');
            const formattedPattern = value ? `${chalk.blue(category)}: ${chalk.white(value)}` : pattern;
            console.log(`  • ${formattedPattern} (${percentage}% of similar symbols)`);
          }
        }
        
        // Show pattern summary if verbose
        if (options.verbose) {
          console.log(chalk.cyan('\n🔍 PATTERN ANALYSIS:'));
          console.log(`  Target symbol has ${targetPatterns.patterns.size} unique patterns`);
          
          const categoryCounts: Record<string, number> = {};
          targetPatterns.categories.forEach((patterns, cat) => {
            categoryCounts[cat] = patterns.size;
          });
          
          console.log('  Pattern distribution:');
          Object.entries(categoryCounts).forEach(([cat, count]) => {
            console.log(`    • ${cat}: ${count} patterns`);
          });
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

// Helper function to find shared patterns between two sets
function findSharedPatterns(patterns1: Set<string>, patterns2: Set<string>): string[] {
  return [...patterns1].filter(x => patterns2.has(x));
}