import chalk from 'chalk';
import type { Symbol, FileResult, SymbolResult } from '../types/index.js';

export class OutputFormatter {
  private static readonly COLORS = {
    primary: chalk.cyan,
    secondary: chalk.yellow,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.blue,
    muted: chalk.gray,
    highlight: chalk.white,
    bold: chalk.bold
  };

  private static readonly ICONS = {
    file: '📄',
    folder: '📁',
    function: '⚡',
    class: '🔷',
    interface: '🔶',
    type: '🏷️',
    variable: '📦',
    method: '🔸',
    enum: '🎲',
    export: '📤',
    import: '📥',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    search: '🔍',
    graph: '📊',
    circular: '🔄',
    unused: '⚪',
    duplicate: '🔁',
    pattern: '🎯',
    impact: '💥',
    endpoint: '🌐',
    bullet: '●',
    arrow: '→',
    tree: '├─',
    lastTree: '└─',
    pipe: '│'
  };

  static formatSymbol(symbol: SymbolResult | Symbol, options: {
    showFile?: boolean;
    showLine?: boolean;
    showType?: boolean;
    showSignature?: boolean;
    indent?: number;
  } = {}): string {
    const { showFile = true, showLine = true, showType = true, showSignature = false, indent = 0 } = options;
    const indentStr = ' '.repeat(indent);
    
    let output = indentStr;
    
    // Add icon based on type
    const icon = this.getIconForType(symbol.type);
    output += `${icon} `;
    
    // Add name
    output += this.COLORS.highlight(symbol.name);
    
    // Add type
    if (showType) {
      output += ` ${this.COLORS.muted(`(${symbol.type})`)}`;
    }
    
    // Add file and line
    if (showFile && 'file' in symbol) {
      output += ` ${this.COLORS.secondary(symbol.file)}`;
      if (showLine && 'line' in symbol) {
        output += `:${symbol.line}`;
      }
    }
    
    // Add signature
    if (showSignature && 'signature' in symbol && symbol.signature) {
      output += `\n${indentStr}  ${this.COLORS.muted(symbol.signature)}`;
    }
    
    return output;
  }

  static formatFile(file: FileResult, options: {
    showLanguage?: boolean;
    showSize?: boolean;
    showSymbolCount?: boolean;
    indent?: number;
  } = {}): string {
    const { showLanguage = true, showSize = false, showSymbolCount = false, indent = 0 } = options;
    const indentStr = ' '.repeat(indent);
    
    let output = `${indentStr}${this.ICONS.file} ${this.COLORS.highlight(file.relativePath)}`;
    
    const details: string[] = [];
    
    if (showLanguage && file.language) {
      details.push(file.language);
    }
    
    if (showSize && 'size' in file) {
      details.push(this.formatSize(file.size as number));
    }
    
    if (showSymbolCount && 'symbolCount' in file) {
      details.push(`${file.symbolCount} symbols`);
    }
    
    if (details.length > 0) {
      output += ` ${this.COLORS.muted(`(${details.join(', ')})`)}`;
    }
    
    return output;
  }

  static formatSection(title: string, content?: string): string {
    let output = `\n${this.COLORS.bold(this.COLORS.primary(title))}\n`;
    if (content) {
      output += content;
    }
    return output;
  }

  static formatList(items: string[], options: {
    bullet?: string;
    indent?: number;
  } = {}): string {
    const { bullet = this.ICONS.bullet, indent = 2 } = options;
    const indentStr = ' '.repeat(indent);
    
    return items.map(item => `${indentStr}${bullet} ${item}`).join('\n');
  }

  static formatTree(node: any, options: {
    nameKey?: string;
    childrenKey?: string;
    indent?: number;
    isLast?: boolean;
    prefix?: string;
  } = {}): string {
    const { 
      nameKey = 'name', 
      childrenKey = 'children', 
      indent = 0, 
      isLast = true,
      prefix = ''
    } = options;
    
    let output = '';
    const connector = isLast ? this.ICONS.lastTree : this.ICONS.tree;
    const extension = isLast ? '  ' : `${this.ICONS.pipe} `;
    
    if (indent > 0) {
      output += `${prefix}${connector}${node[nameKey]}\n`;
    } else {
      output += `${node[nameKey]}\n`;
    }
    
    const children = node[childrenKey] || [];
    children.forEach((child: any, index: number) => {
      const newPrefix = indent > 0 ? prefix + extension : '';
      output += this.formatTree(child, {
        ...options,
        indent: indent + 1,
        isLast: index === children.length - 1,
        prefix: newPrefix
      });
    });
    
    return output;
  }

  static formatStats(stats: Record<string, number | string>): string {
    const lines: string[] = [];
    
    for (const [key, value] of Object.entries(stats)) {
      const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      let formattedValue = value.toString();
      
      if (typeof value === 'number' && key.toLowerCase().includes('size')) {
        formattedValue = this.formatSize(value);
      } else if (typeof value === 'number' && key.toLowerCase().includes('time')) {
        formattedValue = this.formatTime(value);
      }
      
      lines.push(`  ${this.ICONS.bullet} ${formattedKey}: ${this.COLORS.highlight(formattedValue)}`);
    }
    
    return lines.join('\n');
  }

  static formatError(message: string): string {
    return `${this.ICONS.error} ${this.COLORS.error(message)}`;
  }

  static formatWarning(message: string): string {
    return `${this.ICONS.warning} ${this.COLORS.warning(message)}`;
  }

  static formatSuccess(message: string): string {
    return `${this.ICONS.success} ${this.COLORS.success(message)}`;
  }

  static formatInfo(message: string): string {
    return `${this.ICONS.info} ${this.COLORS.info(message)}`;
  }

  static formatHeader(text: string): string {
    return this.COLORS.bold(this.COLORS.primary(text));
  }

  static formatSubheader(text: string): string {
    return this.COLORS.secondary(text);
  }

  static formatCode(code: string, language?: string): string {
    const header = language ? `\`\`\`${language}\n` : '```\n';
    return `${header}${code}\n\`\`\``;
  }

  static formatSummary(title: string, items: Array<{ label: string; value: string | number }>): string {
    let output = `\n${this.COLORS.bold(this.COLORS.primary(`${this.ICONS.graph} ${title}`))}\n`;
    
    for (const item of items) {
      output += `  ${this.ICONS.bullet} ${item.label}: ${this.COLORS.highlight(item.value.toString())}\n`;
    }
    
    return output;
  }

  private static getIconForType(type: string): string {
    switch (type.toLowerCase()) {
      case 'function': return this.ICONS.function;
      case 'class': return this.ICONS.class;
      case 'interface': return this.ICONS.interface;
      case 'type': return this.ICONS.type;
      case 'variable':
      case 'const':
      case 'let': return this.ICONS.variable;
      case 'method': return this.ICONS.method;
      case 'enum': return this.ICONS.enum;
      case 'export': return this.ICONS.export;
      case 'import': return this.ICONS.import;
      default: return this.ICONS.bullet;
    }
  }

  private static formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  private static formatTime(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else {
      return `${(ms / 60000).toFixed(2)}m`;
    }
  }

  static formatTable(rows: Array<Record<string, any>>, options: {
    headers?: string[];
    maxWidth?: number;
  } = {}): string {
    if (rows.length === 0) return '';
    
    const headers = options.headers || Object.keys(rows[0]);
    const maxWidth = options.maxWidth || 80;
    
    // Calculate column widths
    const widths: Record<string, number> = {};
    for (const header of headers) {
      widths[header] = header.length;
      for (const row of rows) {
        const value = (row[header] || '').toString();
        widths[header] = Math.max(widths[header], value.length);
      }
    }
    
    // Build table
    let output = '';
    
    // Header
    output += headers.map(h => h.padEnd(widths[h])).join(' │ ') + '\n';
    output += headers.map(h => '─'.repeat(widths[h])).join('─┼─') + '\n';
    
    // Rows
    for (const row of rows) {
      output += headers.map(h => (row[h] || '').toString().padEnd(widths[h])).join(' │ ') + '\n';
    }
    
    return output;
  }
}