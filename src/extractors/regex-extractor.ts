import { BaseExtractor } from './base.js';
import type { FileInfo, ExtractedContext, Symbol, CallReference } from '../types/index.js';
import type { StructureCategory, SymbolDetail } from './types.js';

interface LanguagePattern {
  functions?: RegExp[];
  classes?: RegExp[];
  imports?: RegExp[];
  exports?: RegExp[];
  comments?: RegExp[];
  variables?: RegExp[];
}

/**
 * Fallback regex-based extractor for all languages
 */
export class RegexExtractor extends BaseExtractor {
  private patterns: Record<string, LanguagePattern> = {
    // C-like languages
    c: {
      functions: [
        /^\s*(?:static\s+)?(?:inline\s+)?(?:const\s+)?(?:\w+[\s*]+)+(\w+)\s*\([^)]*\)\s*\{/gm,
        /^\s*(?:static\s+)?(?:inline\s+)?(?:const\s+)?(?:\w+[\s*]+)+(\w+)\s*\([^)]*\);/gm
      ],
      classes: [
        /^\s*(?:typedef\s+)?struct\s+(\w+)/gm,
        /^\s*(?:typedef\s+)?enum\s+(\w+)/gm,
        /^\s*(?:typedef\s+)?union\s+(\w+)/gm
      ],
      imports: [
        /#include\s*[<"]([^>"]+)[>"]/gm
      ],
      comments: [
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm
      ]
    },
    cpp: {
      functions: [
        /^\s*(?:template\s*<[^>]*>\s*)?(?:static\s+)?(?:inline\s+)?(?:virtual\s+)?(?:const\s+)?(?:explicit\s+)?(?:\w+[\s*&]+)+(\w+)\s*\([^)]*\)(?:\s*const)?(?:\s*override)?(?:\s*noexcept)?(?:\s*->\s*[\w:]+)?\s*\{/gm,
        /^\s*(?:template\s*<[^>]*>\s*)?(?:friend\s+)?(?:\w+[\s*&]+)+operator\s*([^\s(]+)\s*\([^)]*\)/gm
      ],
      classes: [
        /^\s*(?:template\s*<[^>]*>\s*)?(?:class|struct)\s+(?:\w+\s+)?(\w+)/gm,
        /^\s*namespace\s+(\w+)/gm
      ],
      imports: [
        /#include\s*[<"]([^>"]+)[>"]/gm,
        /using\s+namespace\s+(\w+)/gm
      ],
      comments: [
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm
      ]
    },
    csharp: {
      functions: [
        /(?:public|private|protected|internal|static|\s)+(?:async\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)/gm
      ],
      classes: [
        /(?:public|private|protected|internal|\s)+(?:abstract\s+)?(?:sealed\s+)?(?:class|interface|struct|enum)\s+(\w+)/gm
      ],
      imports: [
        /using\s+([\w.]+);/gm
      ],
      comments: [
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm,
        /\/\/\/.*$/gm
      ]
    },
    java: {
      functions: [
        /(?:public|private|protected|static|\s)+(?:synchronized\s+)?(?:final\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)(?:\s+throws\s+[\w,\s]+)?\s*\{/gm
      ],
      classes: [
        /(?:public|private|protected|\s)+(?:abstract\s+)?(?:final\s+)?(?:class|interface|enum)\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/gm
      ],
      imports: [
        /import\s+(?:static\s+)?([\w.*]+);/gm
      ],
      exports: [
        /package\s+([\w.]+);/gm
      ],
      comments: [
        /\/\*\*[\s\S]*?\*\//gm,
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm
      ]
    },
    kotlin: {
      functions: [
        /(?:override\s+)?(?:suspend\s+)?(?:inline\s+)?(?:private|public|protected|internal\s+)?fun\s+(?:<[^>]+>\s+)?(\w+)\s*\([^)]*\)/gm
      ],
      classes: [
        /(?:data\s+)?(?:sealed\s+)?(?:abstract\s+)?(?:open\s+)?(?:class|interface|object)\s+(\w+)/gm
      ],
      imports: [
        /import\s+([\w.*]+)/gm
      ],
      comments: [
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm
      ]
    },
    swift: {
      functions: [
        /(?:@\w+\s+)?(?:private|public|internal|fileprivate|open\s+)?(?:static\s+)?(?:override\s+)?(?:mutating\s+)?func\s+(\w+)(?:<[^>]+>)?\s*\([^)]*\)/gm
      ],
      classes: [
        /(?:final\s+)?(?:public|private|internal|open\s+)?(?:class|struct|enum|protocol|extension)\s+(\w+)/gm
      ],
      imports: [
        /import\s+(\w+)/gm
      ],
      comments: [
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm
      ]
    },
    go: {
      functions: [
        /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\([^)]*\)(?:\s+(?:\([^)]+\)|\w+))?/gm
      ],
      classes: [
        /type\s+(\w+)\s+(?:struct|interface)\s*\{/gm
      ],
      imports: [
        /import\s+(?:\([^)]+\)|"[^"]+")/gm
      ],
      comments: [
        /\/\/.*$/gm,
        /\/\*[\s\S]*?\*\//gm
      ]
    },
    rust: {
      functions: [
        /(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]+"\s+)?fn\s+(\w+)(?:<[^>]+>)?\s*\([^)]*\)/gm
      ],
      classes: [
        /(?:pub(?:\([^)]+\))?\s+)?(?:struct|enum|trait|type)\s+(\w+)(?:<[^>]+>)?/gm,
        /impl(?:<[^>]+>)?\s+(?:\w+\s+for\s+)?(\w+)/gm
      ],
      imports: [
        /use\s+([\w:]+)(?:::\{[^}]+\})?;/gm
      ],
      comments: [
        /\/\/(?:\/|!)?.*$/gm,
        /\/\*[\s\S]*?\*\//gm
      ]
    },
    ruby: {
      functions: [
        /def\s+(?:self\.)?(\w+(?:[?!])?)/gm
      ],
      classes: [
        /class\s+(\w+)(?:\s*<\s*\w+)?/gm,
        /module\s+(\w+)/gm
      ],
      imports: [
        /require(?:_relative)?\s+['"]([^'"]+)['"]/gm,
        /load\s+['"]([^'"]+)['"]/gm
      ],
      comments: [
        /#.*$/gm,
        /=begin[\s\S]*?=end/gm
      ]
    },
    php: {
      functions: [
        /(?:public|private|protected|static|\s)+function\s+(\w+)\s*\([^)]*\)/gm
      ],
      classes: [
        /(?:abstract\s+)?(?:final\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/gm,
        /interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?/gm,
        /trait\s+(\w+)/gm
      ],
      imports: [
        /(?:require|include)(?:_once)?\s*\(?['"]([^'"]+)['"]\)?/gm,
        /use\s+([\w\\]+)(?:\s+as\s+\w+)?;/gm
      ],
      variables: [
        /\$(\w+)\s*=/gm
      ],
      comments: [
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm,
        /#.*$/gm
      ]
    },
    scala: {
      functions: [
        /(?:override\s+)?(?:private|protected|public\s+)?def\s+(\w+)(?:\[[^\]]+\])?\s*(?:\([^)]*\))?/gm
      ],
      classes: [
        /(?:sealed\s+)?(?:abstract\s+)?(?:case\s+)?(?:class|trait|object)\s+(\w+)/gm
      ],
      imports: [
        /import\s+([\w.]+)(?:\.\{[^}]+\})?/gm
      ],
      comments: [
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm
      ]
    },
    perl: {
      functions: [
        /sub\s+(\w+)\s*(?:\([^)]*\))?\s*\{/gm
      ],
      classes: [
        /package\s+([\w:]+);/gm
      ],
      imports: [
        /use\s+([\w:]+)/gm,
        /require\s+([\w:]+)/gm
      ],
      variables: [
        /(?:my|our|local)\s+[$@%](\w+)/gm
      ],
      comments: [
        /#.*$/gm,
        /^=\w+[\s\S]*?^=cut/gm
      ]
    },
    lua: {
      functions: [
        /(?:local\s+)?function\s+(\w+)\s*\([^)]*\)/gm,
        /(?:local\s+)?(\w+)\s*=\s*function\s*\([^)]*\)/gm
      ],
      imports: [
        /require\s*\(?['"]([^'"]+)['"]\)?/gm
      ],
      variables: [
        /(?:local\s+)?(\w+)\s*=/gm
      ],
      comments: [
        /--\[\[[\s\S]*?\]\]/gm,
        /--.*$/gm
      ]
    },
    shell: {
      functions: [
        /(?:function\s+)?(\w+)\s*\(\)\s*\{/gm
      ],
      variables: [
        /(\w+)=/gm
      ],
      imports: [
        /source\s+["']?([^"'\s]+)["']?/gm,
        /\.\s+["']?([^"'\s]+)["']?/gm
      ],
      comments: [
        /#.*$/gm
      ]
    },
    r: {
      functions: [
        /(\w+)\s*<-\s*function\s*\([^)]*\)/gm,
        /(\w+)\s*=\s*function\s*\([^)]*\)/gm
      ],
      imports: [
        /(?:library|require)\s*\(["']?(\w+)["']?\)/gm,
        /source\s*\(["']([^"']+)["']\)/gm
      ],
      variables: [
        /(\w+)\s*<-/gm,
        /(\w+)\s*=/gm
      ],
      comments: [
        /#.*$/gm
      ]
    },
    julia: {
      functions: [
        /function\s+(\w+)(?:\([^)]*\))?/gm,
        /(\w+)\([^)]*\)\s*=/gm
      ],
      classes: [
        /(?:mutable\s+)?struct\s+(\w+)/gm,
        /abstract\s+type\s+(\w+)/gm
      ],
      imports: [
        /using\s+([\w.]+)/gm,
        /import\s+([\w.]+)/gm
      ],
      comments: [
        /#=[\s\S]*?=#/gm,
        /#.*$/gm
      ]
    },
    elixir: {
      functions: [
        /def(?:p)?\s+(\w+)(?:\([^)]*\))?\s+do/gm
      ],
      classes: [
        /defmodule\s+([\w.]+)\s+do/gm
      ],
      imports: [
        /(?:import|require|use|alias)\s+([\w.]+)/gm
      ],
      comments: [
        /#.*$/gm
      ]
    },
    haskell: {
      functions: [
        /^(\w+)\s*::/gm,
        /^(\w+)\s+.*=/gm
      ],
      imports: [
        /import\s+(?:qualified\s+)?([\w.]+)/gm
      ],
      comments: [
        /--.*$/gm,
        /\{-[\s\S]*?-\}/gm
      ]
    },
    clojure: {
      functions: [
        /\(defn?\s+(\S+)/gm,
        /\(defmacro\s+(\S+)/gm
      ],
      imports: [
        /\(:require\s+\[([^\]]+)\]/gm,
        /\(:import\s+\[([^\]]+)\]/gm
      ],
      comments: [
        /;.*$/gm
      ]
    },
    erlang: {
      functions: [
        /^(\w+)\s*\([^)]*\)\s*->/gm
      ],
      imports: [
        /-include\s*\("([^"]+)"\)/gm,
        /-import\s*\((\w+),/gm
      ],
      exports: [
        /-export\s*\(\[([^\]]+)\]\)/gm
      ],
      comments: [
        /%.*$/gm
      ]
    },
    nim: {
      functions: [
        /proc\s+(\w+)(?:\*)?(?:\[[^\]]+\])?\s*\([^)]*\)/gm,
        /func\s+(\w+)(?:\*)?(?:\[[^\]]+\])?\s*\([^)]*\)/gm,
        /template\s+(\w+)(?:\*)?(?:\[[^\]]+\])?\s*\([^)]*\)/gm
      ],
      classes: [
        /type\s+(\w+)(?:\*)?(?:\[[^\]]+\])?\s*=/gm
      ],
      imports: [
        /import\s+([\w/]+)/gm,
        /from\s+([\w/]+)\s+import/gm
      ],
      comments: [
        /#.*$/gm,
        /#\[[\s\S]*?\]#/gm
      ]
    },
    dart: {
      functions: [
        /(?:static\s+)?(?:Future<[^>]+>\s+)?(?:void\s+)?(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)/gm
      ],
      classes: [
        /(?:abstract\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+\w+)?(?:\s+(?:with|implements)\s+[\w,\s]+)?/gm
      ],
      imports: [
        /import\s+['"]([^'"]+)['"]/gm
      ],
      comments: [
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm
      ]
    },
    zig: {
      functions: [
        /(?:pub\s+)?(?:export\s+)?fn\s+(\w+)\s*\([^)]*\)/gm
      ],
      classes: [
        /const\s+(\w+)\s*=\s*(?:struct|enum|union)/gm
      ],
      imports: [
        /@import\s*\("([^"]+)"\)/gm
      ],
      comments: [
        /\/\/.*$/gm
      ]
    },
    vlang: {
      functions: [
        /(?:pub\s+)?fn\s+(?:\([^)]+\)\s+)?(\w+)\s*\([^)]*\)/gm
      ],
      classes: [
        /struct\s+(\w+)\s*\{/gm
      ],
      imports: [
        /import\s+([\w.]+)/gm
      ],
      comments: [
        /\/\/.*$/gm,
        /\/\*[\s\S]*?\*\//gm
      ]
    },
    solidity: {
      functions: [
        /function\s+(\w+)\s*\([^)]*\)(?:\s+(?:public|private|internal|external))?(?:\s+(?:view|pure|payable))?(?:\s+returns\s*\([^)]*\))?/gm
      ],
      classes: [
        /contract\s+(\w+)(?:\s+is\s+[\w,\s]+)?/gm,
        /interface\s+(\w+)/gm,
        /library\s+(\w+)/gm
      ],
      imports: [
        /import\s+(?:"([^"]+)"|'([^']+)')/gm
      ],
      variables: [
        /(?:uint\d*|int\d*|address|bool|string|bytes\d*)\s+(?:public\s+)?(\w+)/gm
      ],
      comments: [
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm
      ]
    }
  };
  
  getSupportedLanguages(): string[] {
    // This extractor can handle any language, but these are optimized
    return Object.keys(this.patterns);
  }
  
  canHandle(_fileInfo: FileInfo): boolean {
    // This is the fallback extractor, it can handle anything
    return true;
  }
  
  getPriority(): number {
    return 1; // Lowest priority, used as fallback
  }
  
  async extract(fileInfo: FileInfo): Promise<ExtractedContext> {
    this.initialize(fileInfo);
    
    const context: ExtractedContext = {
      symbols: [],
      imports: [],
      exports: [],
      dependencies: [],
      comments: [],
      calls: [],
      structure: {}
    };
    
    const language = fileInfo.language || '';
    const patterns = this.patterns[language] || this.getGenericPatterns();
    
    // Extract functions
    if (patterns.functions) {
      patterns.functions.forEach(pattern => {
        this.extractSymbolsByPattern(pattern, 'function', context.symbols);
      });
    }
    
    // Extract classes
    if (patterns.classes) {
      patterns.classes.forEach(pattern => {
        this.extractSymbolsByPattern(pattern, 'class', context.symbols);
      });
    }
    
    // Extract variables
    if (patterns.variables) {
      patterns.variables.forEach(pattern => {
        this.extractSymbolsByPattern(pattern, 'variable', context.symbols);
      });
    }
    
    // Extract imports
    if (patterns.imports) {
      patterns.imports.forEach(pattern => {
        const matches = Array.from(this.content.matchAll(pattern));
        matches.forEach(match => {
          if (match[1]) {
            context.imports.push(match[1]);
            context.dependencies.push(match[1]);
          }
        });
      });
    }
    
    // Extract exports
    if (patterns.exports) {
      patterns.exports.forEach(pattern => {
        const matches = Array.from(this.content.matchAll(pattern));
        matches.forEach(match => {
          if (match[1]) {
            context.exports.push(match[1]);
          }
        });
      });
    }
    
    // Extract comments
    if (patterns.comments) {
      patterns.comments.forEach(pattern => {
        const matches = Array.from(this.content.matchAll(pattern));
        matches.forEach(match => {
          context.comments.push(match[0]);
        });
      });
    } else {
      context.comments = this.extractComments();
    }
    
    // Extract function calls
    context.calls = this.extractFunctionCalls(language);
    
    // Build structure
    context.structure = this.buildStructure(context.symbols);
    
    return context;
  }
  
  private getGenericPatterns(): LanguagePattern {
    // Generic patterns that work across many languages
    return {
      functions: [
        /(?:function|def|fn|func|sub|method|proc)\s+(\w+)/gm,
        /(\w+)\s*[:=]\s*(?:function|lambda|\([^)]*\)\s*=>)/gm
      ],
      classes: [
        /(?:class|struct|interface|trait|type|module)\s+(\w+)/gm
      ],
      imports: [
        /(?:import|require|include|use|using|load)\s+['"]*([^'";\s]+)/gm
      ],
      comments: [
        /\/\*[\s\S]*?\*\//gm,
        /\/\/.*$/gm,
        /#.*$/gm,
        /--.*$/gm
      ],
      variables: [
        /(?:const|let|var|val)\s+(\w+)/gm
      ]
    };
  }
  
  private extractSymbolsByPattern(pattern: RegExp, type: Symbol['type'], symbols: Symbol[]): void {
    const matches = Array.from(this.content.matchAll(pattern));
    
    matches.forEach(match => {
      if (match[1]) {
        const lineNumber = this.getLineNumber(match.index || 0);
        const endLine = this.findSymbolEnd(lineNumber);
        
        symbols.push({
          name: match[1],
          type,
          lineStart: lineNumber,
          lineEnd: endLine,
          signature: match[0].replace(/\s+/g, ' ').trim(),
          metadata: {
            raw: match[0]
          }
        });
      }
    });
  }
  
  private findSymbolEnd(startLine: number): number {
    const startIndent = this.getIndentation(this.lines[startLine - 1]);
    
    // For languages with braces, find matching closing brace
    const line = this.lines[startLine - 1];
    if (line.includes('{')) {
      return this.findBlockEnd(startLine);
    }
    
    // For indentation-based languages
    for (let i = startLine; i < this.lines.length; i++) {
      const currentLine = this.lines[i];
      const indent = this.getIndentation(currentLine);
      
      if (indent <= startIndent && i > startLine && currentLine.trim()) {
        return i;
      }
    }
    
    return Math.min(startLine + 10, this.lines.length);
  }
  
  private extractFunctionCalls(_language: string): CallReference[] {
    const calls: CallReference[] = [];
    
    // Language-specific call patterns
    const patterns: RegExp[] = [
      /\b([a-zA-Z_]\w*)\s*\(/g, // Function calls
      /\b(\w+)\.(\w+)\s*\(/g,    // Method calls
      /new\s+(\w+)\s*\(/g        // Constructor calls
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(this.content)) !== null) {
        const name = match[2] ? `${match[1]}.${match[2]}` : match[1];
        
        if (!this.isKeyword(name, _language)) {
          calls.push({
            calleeName: name,
            callType: match[0].startsWith('new') ? 'constructor' : 
                     match[2] ? 'method' : 'function',
            line: this.getLineNumber(match.index),
            column: this.getColumnNumber(match.index),
            isExternal: false
          });
        }
      }
    });
    
    return calls;
  }
  
  private isKeyword(word: string, _language: string): boolean {
    const commonKeywords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'throw', 'try', 'catch', 'finally', 'class', 'function',
      'const', 'let', 'var', 'new', 'this', 'true', 'false', 'null'
    ]);
    
    return commonKeywords.has(word);
  }
  
  private buildStructure(symbols: Symbol[]): StructureCategory {
    const structure: StructureCategory = {};
    
    symbols.forEach(symbol => {
      const category = this.getCategory(symbol.type);
      if (!structure[category]) {
        structure[category] = [];
      }
      
      const detail: SymbolDetail = {
        name: symbol.name,
        line: symbol.lineStart,
        signature: symbol.signature || ''
      };
      structure[category].push(detail);
    });
    
    return structure;
  }
  
  private getCategory(type: Symbol['type']): string {
    const categoryMap: Record<Symbol['type'], string> = {
      'function': 'functions',
      'method': 'methods',
      'class': 'classes',
      'interface': 'interfaces',
      'type': 'types',
      'struct': 'structs',
      'enum': 'enums',
      'trait': 'traits',
      'variable': 'variables',
      'constant': 'constants',
      'property': 'properties',
      'namespace': 'namespaces',
      'module': 'modules',
      'export': 'exports',
      'import': 'imports',
      'decorator': 'decorators',
      'endpoint': 'endpoints',
      'middleware': 'middleware'
    };
    
    return categoryMap[type] || 'other';
  }
}