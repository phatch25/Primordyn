#!/usr/bin/env node

import { createCLI } from './commands/index.js';
import chalk from 'chalk';

async function main() {
  try {
    const program = createCLI();
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error(chalk.red('❌ Unexpected error:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('❌ Unhandled promise rejection:'), reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ Uncaught exception:'), error.message);
  process.exit(1);
});

main();