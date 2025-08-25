import { Command } from 'commander';
import { AliasManager } from '../config/aliases.js';
import chalk from 'chalk';
import { getHelpText } from '../utils/help-texts.js';

export const aliasCommand = new Command('alias')
  .description('Manage search aliases for semantic queries')
  .addHelpText('after', getHelpText('alias'))
  .action(async () => {
    // List all aliases when no subcommand provided
    const aliasManager = new AliasManager(process.cwd());
    const aliases = aliasManager.listAliases();
    
    if (aliases.length === 0) {
      console.log(chalk.yellow('No aliases configured'));
      return;
    }
    
    console.log(chalk.bold('\n📝 Search Aliases:'));
    console.log(chalk.gray('─'.repeat(60)));
    
    aliases.forEach(alias => {
      console.log(chalk.cyan(`\n  ${alias.name}`));
      if (alias.description) {
        console.log(chalk.gray(`  ${alias.description}`));
      }
      console.log(chalk.dim(`  → ${alias.expansion}`));
    });
    
    console.log(chalk.gray('\n─'.repeat(60)));
    console.log(chalk.dim('\nUse "primordyn alias add <name> <expansion>" to add new aliases'));
    console.log(chalk.dim('Use "primordyn alias remove <name>" to remove an alias'));
  });

// Add subcommand
aliasCommand
  .command('add')
  .description('Add a new search alias')
  .argument('<name>', 'Alias name (e.g., "database")')
  .argument('<expansion>', 'Expanded search terms (e.g., "query OR insert OR update")')
  .option('-d, --description <desc>', 'Optional description of the alias')
  .action(async (name: string, expansion: string, options: { description?: string }) => {
    const aliasManager = new AliasManager(process.cwd());
    
    // Check if alias already exists
    const existing = aliasManager.getAlias(name);
    if (existing) {
      console.log(chalk.yellow(`⚠️  Alias "${name}" already exists`));
      console.log(chalk.dim(`   Current expansion: ${existing.expansion}`));
      console.log(chalk.dim(`   Use "primordyn alias update" to modify it`));
      return;
    }
    
    aliasManager.addAlias(name, expansion, options.description);
    console.log(chalk.green(`✅ Added alias "${name}"`));
    console.log(chalk.dim(`   Expands to: ${expansion}`));
  });

// Update subcommand
aliasCommand
  .command('update')
  .description('Update an existing search alias')
  .argument('<name>', 'Alias name to update')
  .argument('<expansion>', 'New expanded search terms')
  .option('-d, --description <desc>', 'Update description')
  .action(async (name: string, expansion: string, options: { description?: string }) => {
    const aliasManager = new AliasManager(process.cwd());
    
    const existing = aliasManager.getAlias(name);
    if (!existing) {
      console.log(chalk.red(`❌ Alias "${name}" not found`));
      console.log(chalk.dim(`   Use "primordyn alias add" to create it`));
      return;
    }
    
    aliasManager.addAlias(name, expansion, options.description || existing.description);
    console.log(chalk.green(`✅ Updated alias "${name}"`));
    console.log(chalk.dim(`   New expansion: ${expansion}`));
  });

// Remove subcommand
aliasCommand
  .command('remove')
  .description('Remove a search alias')
  .argument('<name>', 'Alias name to remove')
  .action(async (name: string) => {
    const aliasManager = new AliasManager(process.cwd());
    
    if (aliasManager.removeAlias(name)) {
      console.log(chalk.green(`✅ Removed alias "${name}"`));
    } else {
      console.log(chalk.red(`❌ Alias "${name}" not found`));
    }
  });

// Show subcommand
aliasCommand
  .command('show')
  .description('Show details of a specific alias')
  .argument('<name>', 'Alias name to show')
  .action(async (name: string) => {
    const aliasManager = new AliasManager(process.cwd());
    const alias = aliasManager.getAlias(name);
    
    if (!alias) {
      console.log(chalk.red(`❌ Alias "${name}" not found`));
      return;
    }
    
    console.log(chalk.bold(`\n📝 Alias: ${alias.name}`));
    if (alias.description) {
      console.log(chalk.gray(`   ${alias.description}`));
    }
    console.log(chalk.cyan('\n   Expands to:'));
    
    // Format the expansion nicely
    const terms = alias.expansion.split(/\s+OR\s+/i);
    terms.forEach(term => {
      console.log(chalk.dim(`     • ${term}`));
    });
  });

// Test subcommand
aliasCommand
  .command('test')
  .description('Test an alias expansion')
  .argument('<search-term>', 'Term to test (can be an alias or regular search)')
  .action(async (searchTerm: string) => {
    const aliasManager = new AliasManager(process.cwd());
    const expanded = aliasManager.expandAlias(searchTerm);
    
    if (expanded === searchTerm) {
      console.log(chalk.yellow(`"${searchTerm}" is not an alias`));
      console.log(chalk.dim('It will be searched as-is'));
    } else {
      console.log(chalk.green(`✅ "${searchTerm}" expands to:`));
      console.log(chalk.cyan(`   ${expanded}`));
    }
  });