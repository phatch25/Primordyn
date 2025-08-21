import { Command } from 'commander';
import { indexCommand } from './index-command.js';
import { queryCommand } from './query-command.js';
import { statsCommand } from './stats-command.js';
import { clearCommand } from './clear-command.js';
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
    });

  // Add essential AI-focused commands
  program.addCommand(indexCommand);
  program.addCommand(queryCommand);
  program.addCommand(statsCommand);
  program.addCommand(clearCommand);

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