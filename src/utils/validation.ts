import chalk from 'chalk';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validatePositiveInteger(value: string, optionName: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new ValidationError(
      `Invalid value for ${optionName}: "${value}". Must be a positive integer.`
    );
  }
  return num;
}

export function validateTokenLimit(value: string): number {
  const num = validatePositiveInteger(value, '--tokens');
  if (num > 100000) {
    console.warn(chalk.yellow(`⚠️  Large token limit (${num}) may affect performance`));
  }
  return num;
}

export function validateFormat(value: string): 'ai' | 'json' | 'human' {
  const validFormats = ['ai', 'json', 'human'] as const;
  if (!validFormats.includes(value as typeof validFormats[number])) {
    throw new ValidationError(
      `Invalid format: "${value}". Must be one of: ${validFormats.join(', ')}`
    );
  }
  return value as 'ai' | 'json' | 'human';
}

export function validateLanguages(value: string): string[] {
  const languages = value.split(',').map(l => l.trim()).filter(Boolean);
  if (languages.length === 0) {
    throw new ValidationError('No languages specified');
  }
  
  const validLanguages = [
    'typescript', 'javascript', 'python', 'go', 'rust', 'java', 
    'c', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin',
    'markdown', 'json', 'yaml', 'toml', 'xml', 'html', 'css'
  ];
  
  const invalid = languages.filter(l => !validLanguages.includes(l));
  if (invalid.length > 0) {
    console.warn(chalk.yellow(`⚠️  Unknown languages: ${invalid.join(', ')}`));
  }
  
  return languages;
}

export function validateDays(value: string): number {
  const num = validatePositiveInteger(value, '--recent');
  if (num > 365) {
    console.warn(chalk.yellow(`⚠️  Large time range (${num} days) may return many results`));
  }
  return num;
}

export function validateDepth(value: string): number {
  const num = validatePositiveInteger(value, '--depth');
  if (num > 5) {
    console.warn(chalk.yellow(`⚠️  Large depth (${num}) may affect performance`));
  }
  return num;
}

export function validatePath(path: string): string {
  // Basic path validation - just ensure it's not empty
  if (!path || path.trim().length === 0) {
    throw new ValidationError('Path cannot be empty');
  }
  return path.trim();
}

export function validateSearchTerm(term: string): string {
  if (!term || term.trim().length === 0) {
    throw new ValidationError('Search term cannot be empty');
  }
  if (term.length < 2) {
    throw new ValidationError('Search term must be at least 2 characters');
  }
  return term.trim();
}