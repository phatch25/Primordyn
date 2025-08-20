import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { ContextRetriever } from '../retriever/index.js';
import chalk from 'chalk';

export const relatedCommand = new Command('related')
  .description('Find files related to a specific file')
  .argument('<file-path>', 'Path to the file')
  .option('-t, --max-tokens <tokens>', 'Maximum tokens in response', '4000')
  .option('-c, --include-content', 'Include file contents')
  .option('--format <format>', 'Output format: json, text', 'text')
  .action(async (filePath: string, options) => {
    try {
      const db = new PrimordynDB();
      const retriever = new ContextRetriever(db);
      
      // First, get the file context to show what we're analyzing
      const sourceFile = await retriever.getFileContext(filePath, {
        includeContent: false,
        includeImports: true
      });
      
      if (!sourceFile) {
        console.log(chalk.red('❌ File not found in index:'), chalk.cyan(filePath));
        console.log('\n' + chalk.yellow('💡 Try:'));
        console.log(`  • Run: ${chalk.cyan('primordyn index')}`);
        console.log(`  • Check file path spelling`);
        console.log(`  • Use: ${chalk.cyan('primordyn stats')} to see indexed files`);
        db.close();
        return;
      }
      
      // Get related files
      const relatedFiles = await retriever.getRelatedFiles(filePath, {
        maxTokens: parseInt(options.maxTokens),
        includeContent: options.includeContent,
        includeImports: true
      });
      
      if (options.format === 'json') {
        console.log(JSON.stringify({ sourceFile, relatedFiles }, null, 2));
        db.close();
        return;
      }
      
      // Text output
      console.log(chalk.blue('🔗 Related Files for:'), chalk.cyan(sourceFile.relativePath));
      console.log(chalk.gray(`   Language: ${sourceFile.language || 'unknown'} | Tokens: ${sourceFile.tokens}`));
      
      if (sourceFile.imports && sourceFile.imports.length > 0) {
        console.log(chalk.gray(`   Imports: ${sourceFile.imports.slice(0, 5).join(', ')}`));
        if (sourceFile.imports.length > 5) {
          console.log(chalk.gray(`   ... and ${sourceFile.imports.length - 5} more`));
        }
      }
      
      console.log(chalk.gray('━'.repeat(60)));
      
      if (relatedFiles.length === 0) {
        console.log(chalk.yellow('No related files found.'));
        console.log('\nThis could mean:');
        console.log('  • File has no imports/dependencies');
        console.log('  • Related files are not indexed');
        console.log('  • File is relatively isolated');
        db.close();
        return;
      }
      
      console.log(chalk.green(`\n📁 Found ${relatedFiles.length} related files:\n`));
      
      relatedFiles.forEach((file, index) => {
        console.log(chalk.blue(`${index + 1}. ${file.relativePath}`));
        console.log(chalk.gray(`   Language: ${file.language || 'unknown'} | Tokens: ${file.tokens}`));
        
        if (file.imports && file.imports.length > 0) {
          const relevantImports = file.imports.filter(imp => 
            sourceFile.imports?.includes(imp) || 
            imp.includes(sourceFile.relativePath.replace(/\.[^.]+$/, ''))
          );
          
          if (relevantImports.length > 0) {
            console.log(chalk.gray(`   Shared imports: ${relevantImports.slice(0, 3).join(', ')}`));
          }
        }
        
        if (file.content && options.includeContent) {
          console.log(chalk.gray('   Preview:'));
          const lines = file.content.split('\n').slice(0, 10);
          lines.forEach(line => {
            const trimmed = line.substring(0, 80);
            console.log(chalk.gray(`     ${trimmed}${line.length > 80 ? '...' : ''}`));
          });
          if (file.content.split('\n').length > 10) {
            console.log(chalk.gray('     ... (truncated)'));
          }
        } else if (file.preview) {
          console.log(chalk.gray('   Preview:'));
          const lines = file.preview.split('\n').slice(0, 3);
          lines.forEach(line => {
            const trimmed = line.substring(0, 80);
            console.log(chalk.gray(`     ${trimmed}${line.length > 80 ? '...' : ''}`));
          });
        }
        
        console.log(); // Empty line between files
      });
      
      // Summary
      console.log(chalk.gray('━'.repeat(60)));
      console.log(chalk.blue('📊 Summary:'));
      console.log(`  • Source file: ${chalk.cyan(sourceFile.relativePath)}`);
      console.log(`  • Related files: ${chalk.yellow(relatedFiles.length)}`);
      console.log(`  • Total tokens: ${chalk.yellow(relatedFiles.reduce((sum, f) => sum + f.tokens, sourceFile.tokens).toLocaleString())}`);
      
      if (!options.includeContent) {
        console.log(chalk.green('\n💡 Tip:'), 'Add', chalk.cyan('--include-content'), 'to see the actual code');
      }
      
      db.close();
      
    } catch (error) {
      console.error(chalk.red('❌ Search failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });