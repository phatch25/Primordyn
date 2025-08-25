import { Command } from 'commander';
import { AliasManager } from '../config/aliases.js';
import chalk from 'chalk';

export const aliasCommand = new Command('alias')
  .description('Manage semantic aliases for grouping related concepts')
  .argument('[name]', 'Alias name to show (shows all if omitted)')
  .argument('[expansion]', 'Terms to expand to (e.g., "login OR logout OR session")')
  .action(async (name?: string, expansion?: string) => {
    const aliasManager = new AliasManager(process.cwd());
    
    // If both provided, set/update the alias
    if (name && expansion) {
      aliasManager.addAlias(name, expansion);
      console.log(chalk.green(`✓ Alias set: ${name}`));
      console.log(chalk.gray(`  Expands to: ${expansion}`));
      return;
    }
    
    // If only name provided, show that alias
    if (name && !expansion) {
      const alias = aliasManager.getAlias(name);
      if (!alias) {
        console.log(chalk.yellow(`No alias found: ${name}`));
        return;
      }
      console.log(chalk.cyan(`${alias.name}:`));
      console.log(`  ${alias.expansion}`);
      return;
    }
    
    // No args - list all aliases
    const aliases = aliasManager.listAliases();
    if (aliases.length === 0) {
      console.log(chalk.gray('No aliases configured'));
      console.log(chalk.gray('Example: primordyn alias auth "login OR logout OR session OR token"'));
      return;
    }
    
    console.log(chalk.bold('Configured aliases:'));
    aliases.forEach(alias => {
      console.log(chalk.cyan(`  ${alias.name}`) + chalk.gray(` → ${alias.expansion}`));
    });
  })
  .addHelpText('after', `
${chalk.bold('Purpose:')}
  Create semantic groups of related terms for easier discovery. Aliases help
  AI assistants find all related code without knowing exact naming conventions.

${chalk.bold('Examples:')}
  ${chalk.gray('# List all configured aliases')}
  $ primordyn alias
  
  ${chalk.gray('# Create an alias for authentication concepts')}
  $ primordyn alias auth "login OR logout OR session OR token OR authenticate"
  
  ${chalk.gray('# Create an alias for database operations')}
  $ primordyn alias database "db OR sql OR query OR connection OR repository"
  
  ${chalk.gray('# Show what an alias expands to')}
  $ primordyn alias auth
  ${chalk.gray('→ auth: login OR logout OR session OR token OR authenticate')}
  
  ${chalk.gray('# Use alias in discovery')}
  $ primordyn list @auth
  ${chalk.gray('→ Searches for: login OR logout OR session OR token OR authenticate')}
  
  ${chalk.gray('# Remove an alias')}
  $ primordyn alias rm auth

${chalk.bold('Common patterns:')}
  • auth → login, logout, session, token, authenticate
  • data → database, db, sql, query, repository
  • api → endpoint, route, controller, handler
  • ui → component, view, render, template
  • test → spec, test, mock, fixture, stub

${chalk.bold('How it works:')}
  • Aliases are project-specific (stored in .primordyn/)
  • Use OR to combine multiple search terms
  • Prefix with @ when using in 'list' command
  • Case-insensitive matching`);

// Remove subcommand - simplified to just the 'rm' shorthand
aliasCommand
  .command('rm <name>')
  .description('Remove an alias')
  .action(async (name: string) => {
    const aliasManager = new AliasManager(process.cwd());
    if (aliasManager.removeAlias(name)) {
      console.log(chalk.green(`✓ Removed alias: ${name}`));
    } else {
      console.log(chalk.yellow(`No alias found: ${name}`));
    }
  });