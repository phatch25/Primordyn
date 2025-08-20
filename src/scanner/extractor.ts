import type { FileInfo, Symbol, ExtractedContext, CallReference } from '../types/index.js';

interface LanguagePattern {
  function: RegExp[];
  class: RegExp[];
  import: RegExp[];
  export: RegExp[];
  comment: RegExp[];
  [key: string]: RegExp[];
}

const LANGUAGE_PATTERNS: Record<string, LanguagePattern> = {
  typescript: {
    function: [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)/gm,
      /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>/gm,
      /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/gm
    ],
    class: [
      /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/gm,
      /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?/gm,
      /(?:export\s+)?type\s+(\w+)\s*=/gm,
      /(?:export\s+)?enum\s+(\w+)/gm
    ],
    import: [
      /import\s+(?:type\s+)?(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/gm,
      /import\s+['"]([^'"]+)['"]/gm,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm
    ],
    export: [
      /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/gm,
      /export\s*\{([^}]+)\}/gm,
      /export\s*\*\s+from\s+['"]([^'"]+)['"]/gm
    ],
    comment: [
      /\/\*\*[\s\S]*?\*\//gm,
      /\/\/.*$/gm,
      /\/\*[\s\S]*?\*\//gm
    ]
  },
  javascript: {
    function: [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/gm,
      /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>/gm,
      /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/gm,
      /(\w+)\s*:\s*(?:async\s+)?function\s*\([^)]*\)/gm
    ],
    class: [
      /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?/gm
    ],
    import: [
      /import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/gm,
      /import\s+['"]([^'"]+)['"]/gm,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm
    ],
    export: [
      /export\s+(?:default\s+)?(?:const|let|var|function|class)\s+(\w+)/gm,
      /export\s*\{([^}]+)\}/gm,
      /module\.exports\s*=\s*(\w+)/gm
    ],
    comment: [
      /\/\*\*[\s\S]*?\*\//gm,
      /\/\/.*$/gm,
      /\/\*[\s\S]*?\*\//gm
    ]
  },
  python: {
    function: [
      /(?:async\s+)?def\s+(\w+)\s*\([^)]*\)/gm,
      /(\w+)\s*=\s*lambda\s+[^:]+:/gm
    ],
    class: [
      /class\s+(\w+)(?:\s*\([^)]*\))?:/gm,
      /@dataclass(?:\([^)]*\))?\s+class\s+(\w+)/gm
    ],
    import: [
      /^import\s+([\w,.]+)/gm,
      /^from\s+([\w.]+)\s+import/gm
    ],
    export: [
      /^__all__\s*=\s*\[([^\]]+)\]/gm
    ],
    comment: [
      /"""[\s\S]*?"""/gm,
      /'''[\s\S]*?'''/gm,
      /#.*$/gm
    ],
    decorator: [
      /@(\w+)(?:\([^)]*\))?/gm
    ]
  },
  java: {
    function: [
      /(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/gm
    ],
    class: [
      /(?:public|private|protected|\s)+(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/gm
    ],
    import: [
      /import\s+(?:static\s+)?([\w.*]+);/gm
    ],
    export: [
      /package\s+([\w.]+);/gm
    ],
    comment: [
      /\/\*\*[\s\S]*?\*\//gm,
      /\/\/.*$/gm,
      /\/\*[\s\S]*?\*\//gm
    ],
    annotation: [
      /@(\w+)(?:\([^)]*\))?/gm
    ]
  },
  go: {
    function: [
      /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\([^)]*\)(?:\s+(?:\([^)]+\)|\w+))?/gm
    ],
    class: [
      /type\s+(\w+)\s+struct\s*\{/gm,
      /type\s+(\w+)\s+interface\s*\{/gm
    ],
    import: [
      /import\s+(?:\([^)]+\)|"[^"]+")/gm
    ],
    export: [
      /^[A-Z]\w*/gm
    ],
    comment: [
      /\/\/.*$/gm,
      /\/\*[\s\S]*?\*\//gm
    ]
  },
  rust: {
    function: [
      /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)(?:<[^>]+>)?\s*\([^)]*\)/gm
    ],
    class: [
      /(?:pub\s+)?struct\s+(\w+)(?:<[^>]+>)?/gm,
      /(?:pub\s+)?enum\s+(\w+)(?:<[^>]+>)?/gm,
      /(?:pub\s+)?trait\s+(\w+)(?:<[^>]+>)?/gm
    ],
    import: [
      /use\s+([\w:]+)(?:::\{[^}]+\})?;/gm
    ],
    export: [
      /pub\s+(?:fn|struct|enum|trait|mod)\s+(\w+)/gm
    ],
    comment: [
      /\/\/(?:\/|!)?.*$/gm,
      /\/\*[\s\S]*?\*\//gm
    ]
  }
};

export class ContextExtractor {
  private content: string;
  private language: string | null;
  private lines: string[];

  constructor(fileInfo: FileInfo) {
    this.content = fileInfo.content;
    this.language = fileInfo.language;
    this.lines = this.content.split('\n');
  }

  public extract(): ExtractedContext {
    const context: ExtractedContext = {
      symbols: [],
      imports: [],
      exports: [],
      dependencies: [],
      comments: [],
      calls: [],
      structure: {}
    };

    if (!this.language || !LANGUAGE_PATTERNS[this.language]) {
      // For unsupported languages, do basic extraction
      return this.extractBasic();
    }

    const patterns = LANGUAGE_PATTERNS[this.language];
    
    // Extract functions
    if (patterns.function) {
      patterns.function.forEach(pattern => {
        this.extractSymbolsByPattern(pattern, 'function', context.symbols);
      });
    }

    // Extract classes and other structures
    if (patterns.class) {
      patterns.class.forEach(pattern => {
        this.extractSymbolsByPattern(pattern, 'class', context.symbols);
      });
    }

    // Extract imports
    if (patterns.import) {
      patterns.import.forEach(pattern => {
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
    if (patterns.export) {
      patterns.export.forEach(pattern => {
        const matches = Array.from(this.content.matchAll(pattern));
        matches.forEach(match => {
          if (match[1]) {
            context.exports.push(match[1]);
          }
        });
      });
    }

    // Extract comments
    if (patterns.comment) {
      patterns.comment.forEach(pattern => {
        const matches = Array.from(this.content.matchAll(pattern));
        matches.forEach(match => {
          context.comments.push(match[0]);
        });
      });
    }

    // Extract function calls
    context.calls = this.extractFunctionCalls();

    // Build structure outline
    context.structure = this.buildStructure(context.symbols);

    return context;
  }

  private extractSymbolsByPattern(pattern: RegExp, type: Symbol['type'], symbols: Symbol[]): void {
    const matches = Array.from(this.content.matchAll(pattern));
    
    matches.forEach(match => {
      if (match[1]) {
        const lineNumber = this.getLineNumber(match.index || 0);
        const endLine = this.findSymbolEnd(lineNumber, this.language || '');
        
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

  private extractBasic(): ExtractedContext {
    const context: ExtractedContext = {
      symbols: [],
      imports: [],
      exports: [],
      dependencies: [],
      comments: [],
      calls: [],
      structure: {}
    };

    // Basic patterns that work across many languages
    const functionPattern = /(?:function|def|fn|func|sub|method)\s+(\w+)/gm;
    const classPattern = /(?:class|struct|interface|trait|type)\s+(\w+)/gm;
    const importPattern = /(?:import|require|include|use|using)\s+['"]*([^'";\s]+)/gm;

    this.extractSymbolsByPattern(functionPattern, 'function', context.symbols);
    this.extractSymbolsByPattern(classPattern, 'class', context.symbols);

    const importMatches = Array.from(this.content.matchAll(importPattern));
    importMatches.forEach(match => {
      if (match[1]) {
        context.imports.push(match[1]);
        context.dependencies.push(match[1]);
      }
    });

    return context;
  }

  private getLineNumber(index: number): number {
    const beforeIndex = this.content.substring(0, index);
    return beforeIndex.split('\n').length;
  }

  private findSymbolEnd(startLine: number, language: string): number {
    // Simple heuristic: find the closing brace or next symbol at the same indentation
    const startIndent = this.getIndentation(this.lines[startLine - 1]);
    
    for (let i = startLine; i < this.lines.length; i++) {
      const line = this.lines[i];
      const indent = this.getIndentation(line);
      
      // Check for closing at same or lower indentation
      if (indent <= startIndent && i > startLine && line.trim()) {
        // Check if it's a new symbol definition
        if (this.isNewSymbol(line, language)) {
          return i;
        }
      }
    }
    
    return this.lines.length;
  }

  private getIndentation(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  private isNewSymbol(line: string, _language: string): boolean {
    const symbolStarts = [
      'function', 'def', 'fn', 'func', 'sub', 'method',
      'class', 'struct', 'interface', 'trait', 'type',
      'const', 'let', 'var', 'public', 'private', 'protected'
    ];
    
    const trimmed = line.trim();
    return symbolStarts.some(start => trimmed.startsWith(start));
  }

  private buildStructure(symbols: Symbol[]): any {
    const structure: any = {
      functions: [],
      classes: [],
      interfaces: [],
      types: [],
      variables: [],
      other: []
    };

    symbols.forEach(symbol => {
      const category = this.categorizeSymbol(symbol.type);
      if (structure[category]) {
        structure[category].push({
          name: symbol.name,
          line: symbol.lineStart,
          signature: symbol.signature
        });
      }
    });

    // Remove empty categories
    Object.keys(structure).forEach(key => {
      if (structure[key].length === 0) {
        delete structure[key];
      }
    });

    return structure;
  }

  private extractFunctionCalls(): CallReference[] {
    const calls: CallReference[] = [];
    const language = this.language || '';
    
    // Define patterns for different types of function calls
    const patterns = {
      // Function calls: functionName(args)
      functionCall: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      // Method calls: object.method(args)
      methodCall: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\.\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      // Constructor calls: new ClassName(args)
      constructorCall: /\bnew\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      // Import statements for tracking external dependencies
      importCall: /(?:import|require)\s*\(?\s*['"`]([^'"`]+)['"`]\s*\)?/g
    };

    // Extract function calls
    let match;
    while ((match = patterns.functionCall.exec(this.content)) !== null) {
      const functionName = match[1];
      // Filter out language keywords and common false positives
      if (!this.isLanguageKeyword(functionName, language)) {
        const lineNumber = this.getLineNumber(match.index);
        const column = this.getColumnNumber(match.index);
        
        calls.push({
          calleeName: functionName,
          callType: 'function',
          line: lineNumber,
          column: column,
          isExternal: false
        });
      }
    }
    
    // Extract method calls
    patterns.methodCall.lastIndex = 0;
    while ((match = patterns.methodCall.exec(this.content)) !== null) {
      const objectName = match[1];
      const methodName = match[2];
      const lineNumber = this.getLineNumber(match.index);
      const column = this.getColumnNumber(match.index);
      
      calls.push({
        calleeName: `${objectName}.${methodName}`,
        callType: 'method',
        line: lineNumber,
        column: column,
        isExternal: false
      });
    }
    
    // Extract constructor calls
    patterns.constructorCall.lastIndex = 0;
    while ((match = patterns.constructorCall.exec(this.content)) !== null) {
      const className = match[1];
      const lineNumber = this.getLineNumber(match.index);
      const column = this.getColumnNumber(match.index);
      
      calls.push({
        calleeName: className,
        callType: 'constructor',
        line: lineNumber,
        column: column,
        isExternal: false
      });
    }
    
    // Extract dynamic imports/requires
    patterns.importCall.lastIndex = 0;
    while ((match = patterns.importCall.exec(this.content)) !== null) {
      const moduleName = match[1];
      const lineNumber = this.getLineNumber(match.index);
      const column = this.getColumnNumber(match.index);
      
      calls.push({
        calleeName: moduleName,
        callType: 'import',
        line: lineNumber,
        column: column,
        isExternal: true
      });
    }
    
    // Deduplicate calls on the same line (keep first occurrence)
    const uniqueCalls = new Map<string, CallReference>();
    calls.forEach(call => {
      const key = `${call.calleeName}:${call.line}:${call.callType}`;
      if (!uniqueCalls.has(key)) {
        uniqueCalls.set(key, call);
      }
    });
    
    return Array.from(uniqueCalls.values());
  }

  private isLanguageKeyword(word: string, language: string): boolean {
    const keywords: Record<string, Set<string>> = {
      typescript: new Set([
        'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
        'return', 'throw', 'try', 'catch', 'finally', 'typeof', 'instanceof',
        'new', 'this', 'super', 'class', 'extends', 'export', 'import', 'default',
        'function', 'const', 'let', 'var', 'async', 'await', 'yield', 'delete',
        'void', 'null', 'undefined', 'true', 'false', 'in', 'of', 'with'
      ]),
      javascript: new Set([
        'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
        'return', 'throw', 'try', 'catch', 'finally', 'typeof', 'instanceof',
        'new', 'this', 'super', 'class', 'extends', 'export', 'import', 'default',
        'function', 'const', 'let', 'var', 'async', 'await', 'yield', 'delete',
        'void', 'null', 'undefined', 'true', 'false', 'in', 'of', 'with'
      ]),
      python: new Set([
        'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'return',
        'def', 'class', 'import', 'from', 'as', 'try', 'except', 'finally',
        'raise', 'with', 'assert', 'pass', 'yield', 'lambda', 'global', 'nonlocal',
        'del', 'is', 'and', 'or', 'not', 'in', 'True', 'False', 'None'
      ])
    };
    
    const langKeywords = keywords[language] || keywords['javascript'];
    return langKeywords.has(word);
  }

  private getColumnNumber(index: number): number {
    const beforeIndex = this.content.substring(0, index);
    const lastNewline = beforeIndex.lastIndexOf('\n');
    return index - lastNewline;
  }

  private categorizeSymbol(type: Symbol['type']): string {
    const categoryMap: Record<Symbol['type'], string> = {
      'function': 'functions',
      'method': 'functions',
      'class': 'classes',
      'interface': 'interfaces',
      'type': 'types',
      'variable': 'variables',
      'constant': 'variables',
      'property': 'variables',
      'export': 'other',
      'import': 'other',
      'namespace': 'other',
      'module': 'other',
      'struct': 'classes',
      'enum': 'types',
      'trait': 'interfaces'
    };

    return categoryMap[type] || 'other';
  }
}