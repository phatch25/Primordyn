import { BaseExtractor } from './base.js';
import type { FileInfo, ExtractedContext, Symbol, CallReference } from '../types/index.js';
import type { StructureCategory, SymbolDetail } from './types.js';

export class PythonExtractor extends BaseExtractor {
  getSupportedLanguages(): string[] {
    return ['python'];
  }
  
  canHandle(fileInfo: FileInfo): boolean {
    return fileInfo.language === 'python';
  }
  
  getPriority(): number {
    return 10;
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
    
    // Extract decorators first (they need to be available for function extraction)
    this.extractDecoratorsAsSymbols(context.symbols);
    
    // Extract functions and methods
    this.extractFunctions(context.symbols);
    
    // Extract classes
    this.extractClasses(context.symbols);
    
    // Extract imports
    this.extractImports(context.imports, context.dependencies);
    
    // Extract exports (__all__)
    this.extractExports(context.exports);
    
    // Extract comments and docstrings
    this.extractPythonComments(context.comments);
    
    // Extract function calls
    this.extractFunctionCalls(context.calls);
    
    // Build structure
    context.structure = this.buildStructure(context.symbols);
    
    return context;
  }
  
  private extractFunctions(symbols: Symbol[]): void {
    // Match regular functions and async functions
    // Updated pattern to handle nested parentheses in parameters like Form(...) or Depends(...)
    const functionPattern = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*(?:->\s*([^:]+))?\s*:/gm;
    
    let match;
    while ((match = functionPattern.exec(this.content)) !== null) {
      const indent = match[1].length;
      const name = match[2];
      const params = match[3];
      const returnType = match[4] || '';
      const lineStart = this.getLineNumber(match.index);
      const lineEnd = this.findPythonBlockEnd(lineStart, indent);
      
      const isAsync = match[0].includes('async');
      const isMethod = indent > 0 && this.isInsideClass(lineStart);
      const decorators = this.extractDecorators(lineStart);
      const signature = `${isAsync ? 'async ' : ''}def ${name}(${params})${returnType ? ' -> ' + returnType : ''}`;
      
      // Determine if this is an endpoint (has route decorators)
      const isEndpoint = this.hasEndpointDecorator(decorators);
      
      symbols.push({
        name,
        type: isEndpoint ? 'endpoint' : (isMethod ? 'method' : 'function'),
        lineStart,
        lineEnd,
        signature,
        metadata: {
          async: isAsync,
          params: this.parseParams(params),
          returnType: returnType.trim(),
          decorators,
          indent,
          isEndpoint
        }
      });
    }
    
    // Match lambda functions
    const lambdaPattern = /(\w+)\s*=\s*lambda\s+([^:]+):\s*(.+)/gm;
    while ((match = lambdaPattern.exec(this.content)) !== null) {
      const name = match[1];
      const params = match[2];
      const lineStart = this.getLineNumber(match.index);
      
      symbols.push({
        name,
        type: 'function',
        lineStart,
        lineEnd: lineStart,
        signature: `${name} = lambda ${params}`,
        metadata: {
          lambda: true,
          params: this.parseParams(params)
        }
      });
    }
  }
  
  private extractClasses(symbols: Symbol[]): void {
    const classPattern = /^(\s*)class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/gm;
    
    let match;
    while ((match = classPattern.exec(this.content)) !== null) {
      const indent = match[1].length;
      const name = match[2];
      const bases = match[3] || '';
      const lineStart = this.getLineNumber(match.index);
      const lineEnd = this.findPythonBlockEnd(lineStart, indent);
      
      let signature = `class ${name}`;
      if (bases) {
        signature += `(${bases})`;
      }
      
      // Extract class members
      const methods: string[] = [];
      const properties: string[] = [];
      this.extractClassMembers(lineStart, lineEnd, methods, properties);
      
      symbols.push({
        name,
        type: 'class',
        lineStart,
        lineEnd,
        signature,
        metadata: {
          bases: bases ? bases.split(',').map(b => b.trim()) : [],
          methods,
          properties,
          decorators: this.extractDecorators(lineStart),
          indent
        }
      });
    }
  }
  
  private extractClassMembers(startLine: number, endLine: number, methods: string[], properties: string[]): void {
    const classContent = this.lines.slice(startLine, endLine).join('\n');
    
    // Extract methods
    const methodPattern = /^\s+def\s+(\w+)\s*\(/gm;
    let match;
    while ((match = methodPattern.exec(classContent)) !== null) {
      methods.push(match[1]);
    }
    
    // Extract class variables (simple pattern)
    const propertyPattern = /^\s+(\w+)\s*[:=]/gm;
    while ((match = propertyPattern.exec(classContent)) !== null) {
      const propName = match[1];
      if (!methods.includes(propName) && !['def', 'class', 'if', 'else', 'for', 'while', 'try', 'except'].includes(propName)) {
        properties.push(propName);
      }
    }
  }
  
  private extractImports(imports: string[], dependencies: string[]): void {
    // Standard imports
    const importPattern = /^import\s+([\w.,\s]+)(?:\s+as\s+\w+)?$/gm;
    let match;
    while ((match = importPattern.exec(this.content)) !== null) {
      const modules = match[1].split(',').map(m => m.trim());
      modules.forEach(module => {
        imports.push(module);
        dependencies.push(module);
      });
    }
    
    // From imports
    const fromImportPattern = /^from\s+([\w.]+)\s+import\s+(.+)$/gm;
    while ((match = fromImportPattern.exec(this.content)) !== null) {
      const module = match[1];
      imports.push(module);
      dependencies.push(module);
    }
  }
  
  private extractExports(exports: string[]): void {
    const allPattern = /^__all__\s*=\s*\[([^\]]+)\]/gm;
    let match;
    while ((match = allPattern.exec(this.content)) !== null) {
      const exportList = match[1];
      const items = exportList.match(/['"](\w+)['"]/g);
      if (items) {
        items.forEach(item => {
          const name = item.replace(/['"]/g, '');
          exports.push(name);
        });
      }
    }
  }
  
  private extractPythonComments(comments: string[]): void {
    // Docstrings (triple quotes)
    const docstringPattern = /"""[\s\S]*?"""|'''[\s\S]*?'''/g;
    let match;
    while ((match = docstringPattern.exec(this.content)) !== null) {
      comments.push(match[0]);
    }
    
    // Single-line comments
    const commentPattern = /#.*$/gm;
    while ((match = commentPattern.exec(this.content)) !== null) {
      // Skip shebang
      if (match.index === 0 && match[0].startsWith('#!')) continue;
      comments.push(match[0]);
    }
  }
  
  private extractFunctionCalls(calls: CallReference[]): void {
    // Function calls
    const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;
    let match;
    while ((match = callPattern.exec(this.content)) !== null) {
      const name = match[1];
      if (!this.isPythonKeyword(name)) {
        calls.push({
          calleeName: name,
          callType: 'function',
          line: this.getLineNumber(match.index),
          column: this.getColumnNumber(match.index),
          isExternal: false
        });
      }
    }
    
    // Method calls
    const methodPattern = /\b(\w+)\.(\w+)\s*\(/g;
    while ((match = methodPattern.exec(this.content)) !== null) {
      const obj = match[1];
      const method = match[2];
      calls.push({
        calleeName: `${obj}.${method}`,
        callType: 'method',
        line: this.getLineNumber(match.index),
        column: this.getColumnNumber(match.index),
        isExternal: false
      });
    }
    
    // Constructor calls (Class instantiation)
    const classPattern = /\b([A-Z]\w*)\s*\(/g;
    while ((match = classPattern.exec(this.content)) !== null) {
      const className = match[1];
      calls.push({
        calleeName: className,
        callType: 'constructor',
        line: this.getLineNumber(match.index),
        column: this.getColumnNumber(match.index),
        isExternal: false
      });
    }
  }
  
  private findPythonBlockEnd(startLine: number, baseIndent: number): number {
    // Python uses indentation to determine block scope
    for (let i = startLine; i < this.lines.length; i++) {
      const line = this.lines[i];
      
      // Skip empty lines and comments
      if (line.trim() === '' || line.trim().startsWith('#')) continue;
      
      const indent = this.getIndentation(line);
      
      // If we find a line with same or less indentation (and it's not empty), block ends
      if (indent <= baseIndent && line.trim()) {
        return i;
      }
    }
    
    return this.lines.length;
  }
  
  private isInsideClass(lineNumber: number): boolean {
    // Check if this line is inside a class definition
    for (let i = lineNumber - 1; i >= 0; i--) {
      const line = this.lines[i];
      if (/^\s*class\s+\w+/.test(line)) {
        const classIndent = this.getIndentation(line);
        const currentIndent = this.getIndentation(this.lines[lineNumber - 1]);
        return currentIndent > classIndent;
      }
      if (/^[^\s]/.test(line) && !line.startsWith('@')) {
        // Hit a non-indented line that's not a decorator
        break;
      }
    }
    return false;
  }
  
  private extractDecorators(lineNumber: number): string[] {
    const decorators: string[] = [];
    
    // Look backwards from the function/class definition
    for (let i = lineNumber - 2; i >= 0; i--) {
      const line = this.lines[i].trim();
      if (line.startsWith('@')) {
        decorators.unshift(line);
      } else if (line !== '') {
        break;
      }
    }
    
    return decorators;
  }
  
  private parseParams(params: string): string[] {
    if (!params.trim()) return [];
    
    // Simple parameter parsing (doesn't handle all edge cases)
    return params.split(',').map(p => {
      // Remove default values and type hints
      const param = p.split('=')[0].split(':')[0].trim();
      return param;
    }).filter(p => p && p !== 'self' && p !== 'cls');
  }
  
  private isPythonKeyword(word: string): boolean {
    const keywords = new Set([
      'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
      'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
      'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
      'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
      'try', 'while', 'with', 'yield',
      // Built-in functions
      'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict',
      'set', 'tuple', 'bool', 'type', 'isinstance', 'issubclass',
      'super', 'property', 'staticmethod', 'classmethod'
    ]);
    return keywords.has(word);
  }
  
  private extractDecoratorsAsSymbols(symbols: Symbol[]): void {
    // Extract decorators as separate symbols for better searchability
    const decoratorPattern = /^(\s*)@([\w.]+)(?:\(([^)]*)\))?\s*$/gm;
    
    let match;
    while ((match = decoratorPattern.exec(this.content)) !== null) {
      const indent = match[1].length;
      const fullName = match[2];
      const args = match[3] || '';
      const lineNumber = this.getLineNumber(match.index);
      
      // Create a symbol for the decorator
      symbols.push({
        name: `@${fullName}`,
        type: 'decorator',
        lineStart: lineNumber,
        lineEnd: lineNumber,
        signature: `@${fullName}${args ? `(${args})` : ''}`,
        metadata: {
          fullName,
          args,
          indent,
          decoratorType: this.getDecoratorType(fullName)
        }
      });
    }
  }
  
  private getDecoratorType(decoratorName: string): string {
    // Identify common decorator types
    const routeDecorators = ['router.get', 'router.post', 'router.put', 'router.delete', 'router.patch', 'app.get', 'app.post', 'app.put', 'app.delete', 'app.patch', 'route'];
    const middlewareDecorators = ['middleware', 'before_request', 'after_request', 'depends'];
    
    const lowerName = decoratorName.toLowerCase();
    
    if (routeDecorators.some(d => lowerName.includes(d))) {
      return 'route';
    }
    if (middlewareDecorators.some(d => lowerName.includes(d))) {
      return 'middleware';
    }
    
    return 'general';
  }
  
  private hasEndpointDecorator(decorators: string[]): boolean {
    // Check if any decorator is a route decorator
    const routePatterns = [
      /@(router|app)\.(get|post|put|delete|patch|head|options)/i,
      /@route\(/i,
      /@(get|post|put|delete|patch)\(/i
    ];
    
    return decorators.some(decorator => 
      routePatterns.some(pattern => pattern.test(decorator))
    );
  }
  
  private buildStructure(symbols: Symbol[]): StructureCategory {
    const structure: StructureCategory = {
      functions: [],
      classes: [],
      methods: [],
      decorators: [],
      endpoints: []
    };
    
    symbols.forEach(symbol => {
      const detail: SymbolDetail = {
        name: symbol.name,
        line: symbol.lineStart,
        signature: symbol.signature || ''
      };
      
      switch (symbol.type) {
        case 'function':
          structure.functions.push(detail);
          break;
        case 'class':
          structure.classes.push(detail);
          break;
        case 'method':
          structure.methods.push(detail);
          break;
        case 'decorator':
          structure.decorators?.push(detail);
          break;
        case 'endpoint':
          structure.endpoints?.push(detail);
          break;
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
}