import { Command } from 'commander';
import { indexCommand } from './index-command.js';
import { queryCommand } from './query-command.js';
import { listCommand } from './list-command.js';
import { statsCommand } from './stats-command.js';
import { clearCommand } from './clear-command.js';
import { aliasCommand } from './alias-command.js';
import { impactCommand } from './impact-command.js';
import { graphCommand } from './graph-command.js';
import chalk from 'chalk';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('primordyn')
    .description('Local context index for AI-assisted development')
    .version('0.1.0')
    .configureHelp({
      sortSubcommands: true,
      subcommandTerm: (cmd) => cmd.name() + ' ' + cmd.usage(),
    })
    .addHelpText('after', `
${chalk.bold('Quick Start:')}
  ${chalk.gray('# First time setup')}
  $ primordyn index                     ${chalk.gray('# Build the index')}
  $ primordyn stats                     ${chalk.gray('# Verify index created')}
  
  ${chalk.gray('# Navigate code')}
  $ primordyn list auth                 ${chalk.gray('# Discover auth-related symbols')}
  $ primordyn query AuthService         ${chalk.gray('# Navigate to AuthService')}
  $ primordyn graph AuthService         ${chalk.gray('# See what it depends on')}

${chalk.bold('Core Commands:')}
  ${chalk.cyan('index')}   - Build/update the searchable index
  ${chalk.cyan('list')}    - Discover symbols with fuzzy search
  ${chalk.cyan('query')}   - Navigate to exact locations
  ${chalk.cyan('graph')}   - Visualize dependencies
  ${chalk.cyan('impact')}  - Assess refactoring risk
  ${chalk.cyan('alias')}   - Create semantic groups
  ${chalk.cyan('stats')}   - View index statistics
  ${chalk.cyan('clear')}   - Remove index

${chalk.bold('Workflow for AI Assistants:')}
  1. ${chalk.cyan('primordyn list <term>')} - Discover relevant symbols
  2. ${chalk.cyan('primordyn query <symbol>')} - Get exact locations
  3. ${chalk.cyan('primordyn query <symbol> --show-graph')} - Understand relationships
  4. ${chalk.cyan('primordyn impact <symbol>')} - Check before refactoring

${chalk.bold('Tips:')}
  • Use aliases for semantic grouping: @auth, @api, @data
  • Run 'index --update' for incremental updates
  • Combine list + query for effective exploration
  • Check impact before major changes
`);

  // Add essential AI-focused commands
  program.addCommand(indexCommand);
  program.addCommand(queryCommand);
  program.addCommand(listCommand);
  program.addCommand(statsCommand);
  program.addCommand(clearCommand);
  program.addCommand(aliasCommand);
  
  // Add analysis commands
  program.addCommand(graphCommand);
  program.addCommand(impactCommand);

  // Global error handler
  program.exitOverride((err) => {
    if (err.code === 'commander.help' || err.code === 'commander.helpDisplayed') {
      process.exit(0);
    }
    if (err.code === 'commander.version') {
      process.exit(0);
    }
    console.error(chalk.red('Error:'), err.message);
    process.exit(1);
  });

  return program;
}