import { Command } from 'commander';
import { indexCommand } from './index-command.js';
import { queryCommand } from './query-command.js';
import { listCommand } from './list-command.js';
import { statsCommand } from './stats-command.js';
import { clearCommand } from './clear-command.js';
import { aliasCommand } from './alias-command.js';
import { endpointsCommand } from './endpoints-command.js';
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
${chalk.bold('Examples:')}
  ${chalk.gray('# Initial setup')}
  $ primordyn index                     ${chalk.gray('# Index current directory')}
  $ primordyn stats                     ${chalk.gray('# View index statistics')}

  ${chalk.gray('# Discovery workflow')}
  $ primordyn list "user"               ${chalk.gray('# Search for items containing "user"')}
  $ primordyn list --type class         ${chalk.gray('# List all classes')}
  $ primordyn list --languages ts,js    ${chalk.gray('# List TypeScript/JavaScript items')}

  ${chalk.gray('# Targeted retrieval')}
  $ primordyn query UserService         ${chalk.gray('# Get detailed context for UserService')}
  $ primordyn query src/auth/login.ts   ${chalk.gray('# Get context for specific file')}

  ${chalk.gray('# Advanced usage')}
  $ primordyn query UserService --show-graph     ${chalk.gray('# Show dependencies')}
  $ primordyn query UserService --impact         ${chalk.gray('# Show impact analysis')}
  $ primordyn endpoints                          ${chalk.gray('# List all API endpoints')}

${chalk.bold('Workflow:')}
  1. Use ${chalk.cyan('list')} to discover and search (fuzzy matching, patterns)
  2. Use ${chalk.cyan('query')} to get detailed context (exact retrieval)
`);

  // Add essential AI-focused commands
  program.addCommand(indexCommand);
  program.addCommand(queryCommand);
  program.addCommand(listCommand);
  program.addCommand(statsCommand);
  program.addCommand(clearCommand);
  program.addCommand(aliasCommand);
  program.addCommand(endpointsCommand);

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