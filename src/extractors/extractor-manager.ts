import { ILanguageExtractor } from './base.js';
import { TypeScriptExtractor } from './typescript-extractor.js';
import { PythonExtractor } from './python-extractor.js';
import { TreeSitterExtractor } from './treesitter-extractor.js';
import { RegexExtractor } from './regex-extractor.js';
import type { FileInfo, ExtractedContext } from '../types/index.js';

/**
 * Manages all language extractors and routes files to the appropriate extractor
 */
export class ExtractorManager {
  private extractors: ILanguageExtractor[] = [];
  private languageMap: Map<string, ILanguageExtractor> = new Map();
  
  constructor() {
    this.registerExtractors();
  }
  
  private registerExtractors(): void {
    // Register extractors in priority order
    const extractors = [
      new TypeScriptExtractor(),  // Priority 10
      new PythonExtractor(),       // Priority 10
      new TreeSitterExtractor(),   // Priority 5
      new RegexExtractor()         // Priority 1 (fallback)
    ];
    
    // Sort by priority (higher first)
    extractors.sort((a, b) => b.getPriority() - a.getPriority());
    
    this.extractors = extractors;
    
    // Build language map for quick lookup
    extractors.forEach(extractor => {
      extractor.getSupportedLanguages().forEach(lang => {
        // Only set if not already set (respects priority)
        if (!this.languageMap.has(lang)) {
          this.languageMap.set(lang, extractor);
        }
      });
    });
  }
  
  /**
   * Extract context from a file using the appropriate extractor
   */
  public async extract(fileInfo: FileInfo): Promise<ExtractedContext> {
    // First, try to find a specific extractor for the language
    if (fileInfo.language && this.languageMap.has(fileInfo.language)) {
      const extractor = this.languageMap.get(fileInfo.language)!;
      try {
        return await extractor.extract(fileInfo);
      } catch {
        // Silently fall through to try other extractors
        // This allows graceful degradation when specific extractors fail
      }
    }
    
    // Try each extractor in priority order
    for (const extractor of this.extractors) {
      if (extractor.canHandle(fileInfo)) {
        try {
          return await extractor.extract(fileInfo);
        } catch {
          // Silently continue to next extractor
          // This allows graceful fallback through the extractor chain
        }
      }
    }
    
    // If all extractors fail, return empty context
    return {
      symbols: [],
      imports: [],
      exports: [],
      dependencies: [],
      comments: [],
      calls: [],
      structure: {}
    };
  }
  
  /**
   * Get all supported languages across all extractors
   */
  public getSupportedLanguages(): string[] {
    const languages = new Set<string>();
    this.extractors.forEach(extractor => {
      extractor.getSupportedLanguages().forEach(lang => languages.add(lang));
    });
    return Array.from(languages).sort();
  }
  
  /**
   * Check if a file can be handled by any extractor
   */
  public canHandle(fileInfo: FileInfo): boolean {
    return this.extractors.some(extractor => extractor.canHandle(fileInfo));
  }
  
  /**
   * Get statistics about registered extractors
   */
  public getStats(): {
    extractorCount: number;
    supportedLanguages: string[];
    extractors: Array<{
      name: string;
      priority: number;
      languages: string[];
    }>;
  } {
    return {
      extractorCount: this.extractors.length,
      supportedLanguages: this.getSupportedLanguages(),
      extractors: this.extractors.map(e => ({
        name: e.constructor.name,
        priority: e.getPriority(),
        languages: e.getSupportedLanguages()
      }))
    };
  }
}