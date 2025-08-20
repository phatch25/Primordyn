import type { FileInfo, ExtractedContext } from '../types/index.js';

/**
 * Base interface for all language extractors
 */
export interface ILanguageExtractor {
  /**
   * Extract symbols and context from source code
   */
  extract(fileInfo: FileInfo): Promise<ExtractedContext>;
  
  /**
   * Check if this extractor can handle the given file
   */
  canHandle(fileInfo: FileInfo): boolean;
  
  /**
   * Get the priority of this extractor (higher = preferred)
   */
  getPriority(): number;
  
  /**
   * Get supported languages
   */
  getSupportedLanguages(): string[];
}

/**
 * Base class with common functionality for language extractors
 */
export abstract class BaseExtractor implements ILanguageExtractor {
  protected content: string;
  protected lines: string[];
  protected language: string | null;
  
  constructor() {
    this.content = '';
    this.lines = [];
    this.language = null;
  }
  
  abstract extract(fileInfo: FileInfo): Promise<ExtractedContext>;
  abstract canHandle(fileInfo: FileInfo): boolean;
  abstract getSupportedLanguages(): string[];
  
  getPriority(): number {
    return 0; // Default priority
  }
  
  protected initialize(fileInfo: FileInfo): void {
    this.content = fileInfo.content;
    this.lines = this.content.split('\n');
    this.language = fileInfo.language;
  }
  
  protected getLineNumber(index: number): number {
    const beforeIndex = this.content.substring(0, index);
    return beforeIndex.split('\n').length;
  }
  
  protected getColumnNumber(index: number): number {
    const beforeIndex = this.content.substring(0, index);
    const lastNewline = beforeIndex.lastIndexOf('\n');
    return index - lastNewline;
  }
  
  protected getIndentation(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }
  
  protected findBlockEnd(startLine: number, openChar: string = '{', closeChar: string = '}'): number {
    let depth = 0;
    let foundOpen = false;
    
    for (let i = startLine - 1; i < this.lines.length; i++) {
      const line = this.lines[i];
      
      for (const char of line) {
        if (char === openChar) {
          depth++;
          foundOpen = true;
        } else if (char === closeChar) {
          depth--;
          if (foundOpen && depth === 0) {
            return i + 1;
          }
        }
      }
    }
    
    return this.lines.length;
  }
  
  protected extractComments(): string[] {
    const comments: string[] = [];
    const multiLineCommentPattern = /\/\*[\s\S]*?\*\//g;
    const singleLineCommentPattern = /\/\/.*$/gm;
    
    // Extract multi-line comments
    let match;
    while ((match = multiLineCommentPattern.exec(this.content)) !== null) {
      comments.push(match[0]);
    }
    
    // Extract single-line comments
    while ((match = singleLineCommentPattern.exec(this.content)) !== null) {
      comments.push(match[0]);
    }
    
    return comments;
  }
}