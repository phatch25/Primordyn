// Tree-sitter would be imported here if properly configured
// import Parser from 'web-tree-sitter';
import { BaseExtractor } from './base.js';
import type { FileInfo, ExtractedContext, Symbol, CallReference } from '../types/index.js';
// import { fileURLToPath } from 'url';
// import { dirname, join } from 'path';
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

// Language configurations
const LANGUAGE_CONFIG: Record<string, {
  wasmPath: string;
  queries: {
    functions: string[];
    classes: string[];
    methods: string[];
    imports: string[];
    calls: string[];
  };
}> = {
  c: {
    wasmPath: 'tree-sitter-c.wasm',
    queries: {
      functions: ['function_definition', 'declaration'],
      classes: ['struct_specifier', 'enum_specifier', 'union_specifier'],
      methods: [],
      imports: ['preproc_include'],
      calls: ['call_expression']
    }
  },
  cpp: {
    wasmPath: 'tree-sitter-cpp.wasm',
    queries: {
      functions: ['function_definition', 'declaration', 'template_declaration'],
      classes: ['class_specifier', 'struct_specifier', 'enum_specifier', 'namespace_definition'],
      methods: ['function_definition', 'declaration'],
      imports: ['preproc_include', 'using_declaration'],
      calls: ['call_expression']
    }
  },
  java: {
    wasmPath: 'tree-sitter-java.wasm',
    queries: {
      functions: ['method_declaration', 'constructor_declaration'],
      classes: ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'],
      methods: ['method_declaration'],
      imports: ['import_declaration'],
      calls: ['method_invocation', 'object_creation_expression']
    }
  },
  go: {
    wasmPath: 'tree-sitter-go.wasm',
    queries: {
      functions: ['function_declaration', 'method_declaration'],
      classes: ['type_declaration'],
      methods: ['method_declaration'],
      imports: ['import_declaration'],
      calls: ['call_expression']
    }
  },
  rust: {
    wasmPath: 'tree-sitter-rust.wasm',
    queries: {
      functions: ['function_item', 'function_signature_item'],
      classes: ['struct_item', 'enum_item', 'trait_item', 'impl_item'],
      methods: ['function_item'],
      imports: ['use_declaration'],
      calls: ['call_expression']
    }
  },
  ruby: {
    wasmPath: 'tree-sitter-ruby.wasm',
    queries: {
      functions: ['method_definition', 'singleton_method_definition'],
      classes: ['class_definition', 'module_definition'],
      methods: ['method_definition'],
      imports: ['require', 'load'],
      calls: ['method_call', 'call']
    }
  },
  php: {
    wasmPath: 'tree-sitter-php.wasm',
    queries: {
      functions: ['function_definition', 'method_declaration'],
      classes: ['class_declaration', 'interface_declaration', 'trait_declaration'],
      methods: ['method_declaration'],
      imports: ['require_expression', 'include_expression', 'use_declaration'],
      calls: ['function_call_expression', 'member_call_expression']
    }
  },
  swift: {
    wasmPath: 'tree-sitter-swift.wasm',
    queries: {
      functions: ['function_declaration'],
      classes: ['class_declaration', 'struct_declaration', 'enum_declaration', 'protocol_declaration'],
      methods: ['function_declaration'],
      imports: ['import_declaration'],
      calls: ['call_expression']
    }
  },
  kotlin: {
    wasmPath: 'tree-sitter-kotlin.wasm',
    queries: {
      functions: ['function_declaration'],
      classes: ['class_declaration', 'object_declaration', 'interface_declaration'],
      methods: ['function_declaration'],
      imports: ['import_directive'],
      calls: ['call_expression']
    }
  }
};

type ParserNode = Record<string, any>;
type TreeSitterParser = Record<string, any>;

export class TreeSitterExtractor extends BaseExtractor {
  private parser: TreeSitterParser | null = null;
  private static initialized = false;
  private static parsers: Map<string, TreeSitterParser> = new Map();
  
  getSupportedLanguages(): string[] {
    return Object.keys(LANGUAGE_CONFIG);
  }
  
  canHandle(fileInfo: FileInfo): boolean {
    return fileInfo.language !== null && 
           Object.keys(LANGUAGE_CONFIG).includes(fileInfo.language);
  }
  
  getPriority(): number {
    return 5; // Medium priority, below specialized extractors
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
    
    if (!fileInfo.language || !LANGUAGE_CONFIG[fileInfo.language]) {
      return context;
    }
    
    try {
      // Initialize parser for this language
      await this.initializeParser(fileInfo.language);
      
      if (!this.parser) {
        return context;
      }
      
      // Parse the content
      const tree = this.parser.parse(this.content);
      const rootNode = tree.rootNode;
      
      // Extract symbols based on language configuration
      const config = LANGUAGE_CONFIG[fileInfo.language];
      
      // Extract functions
      this.extractNodesByTypes(rootNode, config.queries.functions, 'function', context.symbols);
      
      // Extract classes and types
      this.extractNodesByTypes(rootNode, config.queries.classes, 'class', context.symbols);
      
      // Extract methods (if separate from functions)
      if (config.queries.methods.length > 0) {
        this.extractNodesByTypes(rootNode, config.queries.methods, 'method', context.symbols);
      }
      
      // Extract imports
      this.extractImports(rootNode, config.queries.imports, context.imports, context.dependencies);
      
      // Extract function calls
      this.extractCalls(rootNode, config.queries.calls, context.calls);
      
      // Extract comments
      this.extractTreeSitterComments(rootNode, context.comments);
      
      // Build structure
      context.structure = this.buildStructure(context.symbols);
      
      tree.delete();
    } catch (error) {
      console.error(`Tree-sitter extraction failed for ${fileInfo.language}:`, error);
      // Fall back to basic extraction
      return this.extractBasic(fileInfo);
    }
    
    return context;
  }
  
  private async initializeParser(language: string): Promise<void> {
    // Check if we already have a parser for this language
    if (TreeSitterExtractor.parsers.has(language)) {
      this.parser = TreeSitterExtractor.parsers.get(language)!;
      return;
    }
    
    try {
      // Initialize tree-sitter if not done
      if (!TreeSitterExtractor.initialized) {
        // await Parser.init();
        TreeSitterExtractor.initialized = true;
      }
      
      // Create new parser
      // const parser = new Parser();
      const parser = {} as TreeSitterParser; // Placeholder until tree-sitter is properly configured
      
      // For now, we'll use a simplified approach
      // In production, you'd load the actual WASM files
      // This is a placeholder that would need actual language bindings
      
      // Store parser for reuse
      TreeSitterExtractor.parsers.set(language, parser);
      this.parser = parser;
    } catch (error) {
      console.error(`Failed to initialize parser for ${language}:`, error);
      this.parser = null;
    }
  }
  
  private extractNodesByTypes(node: ParserNode, types: string[], symbolType: Symbol['type'], symbols: Symbol[]): void {
    if (!node) return;
    
    // Check if current node matches any of the types
    if (types.includes(node.type)) {
      const symbol = this.nodeToSymbol(node, symbolType);
      if (symbol) {
        symbols.push(symbol);
      }
    }
    
    // Recursively check children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.extractNodesByTypes(child, types, symbolType, symbols);
      }
    }
  }
  
  private nodeToSymbol(node: ParserNode, type: Symbol['type']): Symbol | null {
    // Extract name from node
    const nameNode = this.findNameNode(node);
    if (!nameNode) return null;
    
    const name = this.content.substring(nameNode.startIndex, nameNode.endIndex);
    const lineStart = node.startPosition.row + 1;
    const lineEnd = node.endPosition.row + 1;
    
    // Extract signature (first line of the node)
    const startIdx = node.startIndex;
    const endIdx = Math.min(node.endIndex, this.content.indexOf('\n', startIdx));
    const signature = this.content.substring(startIdx, endIdx > 0 ? endIdx : node.endIndex).trim();
    
    return {
      name,
      type,
      lineStart,
      lineEnd,
      signature,
      metadata: {
        nodeType: node.type
      }
    };
  }
  
  private findNameNode(node: ParserNode): ParserNode | null {
    // Look for common name node types
    const nameTypes = ['identifier', 'field_identifier', 'type_identifier', 'property_identifier'];
    
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && nameTypes.includes(child.type)) {
        return child;
      }
    }
    
    // Try to find name in children recursively (but only go one level deep)
    for (let i = 0; i < node.childCount && i < 3; i++) {
      const child = node.child(i);
      if (child) {
        for (let j = 0; j < child.childCount; j++) {
          const grandchild = child.child(j);
          if (grandchild && nameTypes.includes(grandchild.type)) {
            return grandchild;
          }
        }
      }
    }
    
    return null;
  }
  
  private extractImports(node: ParserNode, types: string[], imports: string[], dependencies: string[]): void {
    if (!node) return;
    
    if (types.includes(node.type)) {
      const importText = this.content.substring(node.startIndex, node.endIndex);
      
      // Extract the actual import path/module
      const match = importText.match(/["'<]([^"'>]+)["'>]/);
      if (match) {
        const importPath = match[1];
        imports.push(importPath);
        dependencies.push(importPath);
      }
    }
    
    // Recursively check children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.extractImports(child, types, imports, dependencies);
      }
    }
  }
  
  private extractCalls(node: ParserNode, types: string[], calls: CallReference[]): void {
    if (!node) return;
    
    if (types.includes(node.type)) {
      const callName = this.extractCallName(node);
      if (callName) {
        calls.push({
          calleeName: callName,
          callType: this.determineCallType(node),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          isExternal: false
        });
      }
    }
    
    // Recursively check children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.extractCalls(child, types, calls);
      }
    }
  }
  
  private extractCallName(node: ParserNode): string | null {
    // Look for function/method name in call expression
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && (child.type === 'identifier' || child.type === 'field_expression')) {
        if (child.type === 'identifier') {
          return this.content.substring(child.startIndex, child.endIndex);
        } else if (child.type === 'field_expression') {
          // Handle method calls like obj.method()
          const fieldName = this.findLastIdentifier(child);
          if (fieldName) {
            return this.content.substring(fieldName.startIndex, fieldName.endIndex);
          }
        }
      }
    }
    return null;
  }
  
  private findLastIdentifier(node: ParserNode): ParserNode | null {
    const lastIdentifier = null;
    
    if (node.type === 'identifier' || node.type === 'field_identifier' || node.type === 'property_identifier') {
      return node;
    }
    
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) {
        const found = this.findLastIdentifier(child);
        if (found) return found;
      }
    }
    
    return lastIdentifier;
  }
  
  private determineCallType(node: any): CallReference['callType'] {
    if (node.type === 'object_creation_expression' || node.type === 'new_expression') {
      return 'constructor';
    }
    
    // Check if it's a method call
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && (child.type === 'field_expression' || child.type === 'member_expression')) {
        return 'method';
      }
    }
    
    return 'function';
  }
  
  private extractTreeSitterComments(node: ParserNode, comments: string[]): void {
    if (!node) return;
    
    if (node.type === 'comment' || node.type === 'line_comment' || node.type === 'block_comment') {
      const comment = this.content.substring(node.startIndex, node.endIndex);
      comments.push(comment);
    }
    
    // Recursively check children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.extractTreeSitterComments(child, comments);
      }
    }
  }
  
  private buildStructure(symbols: Symbol[]): Record<string, any> {
    const structure: Record<string, any> = {};
    
    symbols.forEach(symbol => {
      const category = this.getCategory(symbol.type);
      if (!structure[category]) {
        structure[category] = [];
      }
      
      structure[category].push({
        name: symbol.name,
        line: symbol.lineStart,
        signature: symbol.signature
      });
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
      'import': 'imports'
    };
    
    return categoryMap[type] || 'other';
  }
  
  private extractBasic(fileInfo: FileInfo): ExtractedContext {
    const context: ExtractedContext = {
      symbols: [],
      imports: [],
      exports: [],
      dependencies: [],
      comments: this.extractComments(),
      calls: [],
      structure: {}
    };
    
    // Language-specific regex patterns for basic extraction
    const patterns = this.getLanguagePatterns(fileInfo.language || '');
    
    if (patterns.functions) {
      this.extractWithPattern(patterns.functions, 'function', context.symbols);
    }
    
    if (patterns.classes) {
      this.extractWithPattern(patterns.classes, 'class', context.symbols);
    }
    
    if (patterns.imports) {
      const matches = Array.from(this.content.matchAll(patterns.imports));
      matches.forEach(match => {
        if (match[1]) {
          context.imports.push(match[1]);
          context.dependencies.push(match[1]);
        }
      });
    }
    
    context.structure = this.buildStructure(context.symbols);
    
    return context;
  }
  
  private getLanguagePatterns(language: string): Record<string, any> {
    const patterns: Record<string, any> = {
      c: {
        functions: /^\s*(?:static\s+)?(?:inline\s+)?(?:\w+\s+)*(\w+)\s*\([^)]*\)\s*\{/gm,
        classes: /^\s*(?:typedef\s+)?struct\s+(\w+)/gm,
        imports: /#include\s*[<"]([^>"]+)[>"]/gm
      },
      cpp: {
        functions: /^\s*(?:template\s*<[^>]*>\s*)?(?:static\s+)?(?:inline\s+)?(?:virtual\s+)?(?:\w+\s+)*(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?(?:noexcept\s*)?\{/gm,
        classes: /^\s*(?:template\s*<[^>]*>\s*)?class\s+(\w+)/gm,
        imports: /#include\s*[<"]([^>"]+)[>"]/gm
      },
      java: {
        functions: /(?:public|private|protected|static|\s)+[\w<>[\]]+\s+(\w+)\s*\([^)]*\)/gm,
        classes: /(?:public|private|protected|\s)+(?:class|interface|enum)\s+(\w+)/gm,
        imports: /import\s+([\w.*]+);/gm
      },
      go: {
        functions: /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\([^)]*\)/gm,
        classes: /type\s+(\w+)\s+(?:struct|interface)/gm,
        imports: /import\s+"([^"]+)"/gm
      },
      rust: {
        functions: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm,
        classes: /(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/gm,
        imports: /use\s+([\w:]+)/gm
      },
      ruby: {
        functions: /def\s+(\w+)/gm,
        classes: /class\s+(\w+)/gm,
        imports: /require\s+['"]([^'"]+)['"]/gm
      },
      php: {
        functions: /function\s+(\w+)\s*\(/gm,
        classes: /class\s+(\w+)/gm,
        imports: /(?:require|include)(?:_once)?\s*\(?['"]([^'"]+)['"]\)?/gm
      },
      swift: {
        functions: /func\s+(\w+)\s*\(/gm,
        classes: /(?:class|struct|enum|protocol)\s+(\w+)/gm,
        imports: /import\s+(\w+)/gm
      },
      kotlin: {
        functions: /fun\s+(\w+)\s*\(/gm,
        classes: /(?:class|interface|object)\s+(\w+)/gm,
        imports: /import\s+([\w.*]+)/gm
      }
    };
    
    return patterns[language] || {};
  }
  
  private extractWithPattern(pattern: RegExp, type: Symbol['type'], symbols: Symbol[]): void {
    let match;
    while ((match = pattern.exec(this.content)) !== null) {
      if (match[1]) {
        const lineStart = this.getLineNumber(match.index);
        symbols.push({
          name: match[1],
          type,
          lineStart,
          lineEnd: lineStart,
          signature: match[0].trim(),
          metadata: {}
        });
      }
    }
  }
}