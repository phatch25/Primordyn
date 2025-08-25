import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import { OutputFormatter } from '../utils/output-formatter.js';
import chalk from 'chalk';
import ora, { Ora } from 'ora';

// Base command class for all CLI commands

export abstract class BaseCommand {
  protected db!: PrimordynDB;
  protected formatter: typeof OutputFormatter;
  protected spinner: Ora | null = null;

  constructor() {
    this.formatter = OutputFormatter;
  }

  protected async initialize(projectPath?: string): Promise<void> {
    this.db = new PrimordynDB(projectPath || process.cwd());
    
    const dbInfo = await this.db.getDatabaseInfo();
    if (dbInfo.fileCount === 0) {
      this.handleNoIndex();
    }
  }

  protected handleNoIndex(): void {
    if (this.spinner) {
      this.spinner.fail(chalk.red('No index found. Run "primordyn index" first.'));
    } else {
      console.log(OutputFormatter.formatError('No index found. Run "primordyn index" first.'));
    }
    process.exit(1);
  }

  protected startSpinner(text: string): void {
    this.spinner = ora(text).start();
  }

  protected stopSpinner(success: boolean = true, message?: string): void {
    if (!this.spinner) return;
    
    if (success) {
      if (message) {
        this.spinner.succeed(message);
      } else {
        this.spinner.stop();
      }
    } else {
      if (message) {
        this.spinner.fail(message);
      } else {
        this.spinner.stop();
      }
    }
    
    this.spinner = null;
  }

  protected updateSpinner(text: string): void {
    if (this.spinner) {
      this.spinner.text = text;
    }
  }

  protected cleanup(): void {
    if (this.db) {
      this.db.close();
    }
    if (this.spinner) {
      this.spinner.stop();
    }
  }

  protected handleError(error: unknown): void {
    this.stopSpinner(false);
    
    if (error instanceof Error) {
      console.error(OutputFormatter.formatError(error.message));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    } else {
      console.error(OutputFormatter.formatError(String(error)));
    }
    
    this.cleanup();
    process.exit(1);
  }

  protected validateOptions(options: Record<string, unknown>, validators: Record<string, (value: unknown) => boolean>): void {
    for (const [key, validator] of Object.entries(validators)) {
      if (options[key] !== undefined && !validator(options[key])) {
        throw new Error(`Invalid value for option --${key}: ${options[key]}`);
      }
    }
  }

  protected formatJson(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }

  protected output(message: string, format: 'text' | 'json' = 'text'): void {
    if (format === 'json') {
      console.log(message);
    } else {
      console.log(message);
    }
  }

  abstract register(program: Command): void;
  abstract execute(options: unknown, ...args: unknown[]): Promise<void>;
}