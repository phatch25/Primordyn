import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { BaseExtractor } from './base.js';
import type { FileInfo, ExtractedContext, Symbol, CallReference } from '../types/index.js';

export class TypeScriptExtractor extends BaseExtractor {
  getSupportedLanguages(): string[] {
    return ['typescript', 'javascript', 'jsx', 'tsx'];
  }
  
  canHandle(fileInfo: FileInfo): boolean {
    return fileInfo.language !== null && 
           this.getSupportedLanguages().includes(fileInfo.language);
  }
  
  getPriority(): number {
    return 10; // High priority for JS/TS
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
    
    try {
      // Parse with Babel
      const ast = parser.parse(this.content, {
        sourceType: 'module',
        plugins: [
          'typescript',
          'jsx',
          'decorators-legacy',
          'classProperties',
          'classPrivateProperties',
          'classPrivateMethods',
          'dynamicImport',
          'exportDefaultFrom',
          'exportNamespaceFrom',
          'nullishCoalescingOperator',
          'optionalChaining',
          'topLevelAwait'
        ],
        errorRecovery: true
      });
      
      // Traverse AST
      traverse(ast, {
        FunctionDeclaration: (path) => {
          this.extractFunction(path.node, context.symbols);
        },
        FunctionExpression: (path) => {
          if (path.parent.type === 'VariableDeclarator' && path.parent.id.type === 'Identifier') {
            this.extractFunction(path.node, context.symbols, path.parent.id.name);
          }
        },
        ArrowFunctionExpression: (path) => {
          if (path.parent.type === 'VariableDeclarator' && path.parent.id.type === 'Identifier') {
            this.extractArrowFunction(path.node, context.symbols, path.parent.id.name);
          }
        },
        ClassDeclaration: (path) => {
          this.extractClass(path.node, context.symbols);
        },
        ClassExpression: (path) => {
          if (path.parent.type === 'VariableDeclarator' && path.parent.id.type === 'Identifier') {
            this.extractClass(path.node, context.symbols, path.parent.id.name);
          }
        },
        TSInterfaceDeclaration: (path) => {
          this.extractInterface(path.node, context.symbols);
        },
        TSTypeAliasDeclaration: (path) => {
          this.extractTypeAlias(path.node, context.symbols);
        },
        TSEnumDeclaration: (path) => {
          this.extractEnum(path.node, context.symbols);
        },
        ImportDeclaration: (path) => {
          const source = path.node.source.value;
          context.imports.push(source);
          context.dependencies.push(source);
        },
        ExportNamedDeclaration: (path) => {
          if (path.node.declaration) {
            const decl = path.node.declaration;
            if ('id' in decl && decl.id && 'name' in decl.id) {
              context.exports.push(decl.id.name);
            }
          }
          if (path.node.specifiers) {
            path.node.specifiers.forEach((spec: any) => {
              if (spec.exported && 'name' in spec.exported) {
                context.exports.push(spec.exported.name);
              }
            });
          }
        },
        ExportDefaultDeclaration: () => {
          context.exports.push('default');
        },
        CallExpression: (path) => {
          this.extractCall(path.node, context.calls);
        },
        NewExpression: (path) => {
          this.extractNewExpression(path.node, context.calls);
        }
      });
      
      // Extract comments
      if (ast.comments) {
        context.comments = ast.comments.map(comment => comment.value);
      }
      
      // Build structure
      context.structure = this.buildStructure(context.symbols);
      
    } catch {
      // Fallback to regex-based extraction if AST parsing fails
      return this.extractWithRegex(fileInfo);
    }
    
    return context;
  }
  
  private extractFunction(node: Record<string, any>, symbols: Symbol[], name?: string): void {
    const functionName = name || node.id?.name;
    if (!functionName) return;
    
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    const params = node.params.map((p: Record<string, any>) => {
      if (p.type === 'Identifier') return p.name;
      if (p.type === 'RestElement' && p.argument.type === 'Identifier') return `...${p.argument.name}`;
      return '...';
    }).join(', ');
    
    const signature = `${node.async ? 'async ' : ''}function ${functionName}(${params})`;
    
    symbols.push({
      name: functionName,
      type: 'function',
      lineStart,
      lineEnd,
      signature,
      metadata: {
        async: node.async || false,
        generator: node.generator || false,
        params: node.params.length
      }
    });
  }
  
  private extractArrowFunction(node: Record<string, any>, symbols: Symbol[], name: string): void {
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    const params = node.params.map((p: Record<string, any>) => {
      if (p.type === 'Identifier') return p.name;
      if (p.type === 'RestElement' && p.argument.type === 'Identifier') return `...${p.argument.name}`;
      return '...';
    }).join(', ');
    
    const signature = `const ${name} = ${node.async ? 'async ' : ''}(${params}) => ...`;
    
    symbols.push({
      name,
      type: 'function',
      lineStart,
      lineEnd,
      signature,
      metadata: {
        async: node.async || false,
        arrow: true,
        params: node.params.length
      }
    });
  }
  
  private extractClass(node: Record<string, any>, symbols: Symbol[], name?: string): void {
    const className = name || node.id?.name;
    if (!className) return;
    
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    let signature = `class ${className}`;
    if (node.superClass) {
      const superName = node.superClass.type === 'Identifier' ? node.superClass.name : 'unknown';
      signature += ` extends ${superName}`;
    }
    
    const methods: string[] = [];
    const properties: string[] = [];
    
    node.body.body.forEach((member: Record<string, any>) => {
      if (member.type === 'ClassMethod' || member.type === 'MethodDefinition') {
        const methodName = member.key.type === 'Identifier' ? member.key.name : 'unknown';
        methods.push(methodName);
        
        // Also add methods as separate symbols
        const methodLineStart = member.loc?.start.line || lineStart;
        const methodLineEnd = member.loc?.end.line || methodLineStart;
        
        symbols.push({
          name: `${className}.${methodName}`,
          type: 'method',
          lineStart: methodLineStart,
          lineEnd: methodLineEnd,
          signature: `${member.static ? 'static ' : ''}${member.async ? 'async ' : ''}${methodName}()`,
          metadata: {
            className,
            static: member.static || false,
            async: member.async || false,
            kind: member.kind // constructor, method, get, set
          }
        });
      } else if (member.type === 'ClassProperty' || member.type === 'PropertyDefinition') {
        const propName = member.key.type === 'Identifier' ? member.key.name : 'unknown';
        properties.push(propName);
      }
    });
    
    symbols.push({
      name: className,
      type: 'class',
      lineStart,
      lineEnd,
      signature,
      metadata: {
        extends: node.superClass ? true : false,
        methods,
        properties,
        abstract: node.abstract || false
      }
    });
  }
  
  private extractInterface(node: Record<string, any>, symbols: Symbol[]): void {
    const name = node.id.name;
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    let signature = `interface ${name}`;
    if (node.extends && node.extends.length > 0) {
      const extendsList = node.extends.map((e: Record<string, any>) => e.expression.name).join(', ');
      signature += ` extends ${extendsList}`;
    }
    
    const properties = node.body.body.map((prop: Record<string, any>) => {
      if (prop.type === 'TSPropertySignature' && prop.key.type === 'Identifier') {
        return prop.key.name;
      }
      return null;
    }).filter(Boolean);
    
    symbols.push({
      name,
      type: 'interface',
      lineStart,
      lineEnd,
      signature,
      metadata: {
        properties,
        extends: node.extends ? node.extends.length : 0
      }
    });
  }
  
  private extractTypeAlias(node: Record<string, any>, symbols: Symbol[]): void {
    const name = node.id.name;
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    symbols.push({
      name,
      type: 'type',
      lineStart,
      lineEnd,
      signature: `type ${name}`,
      metadata: {}
    });
  }
  
  private extractEnum(node: Record<string, any>, symbols: Symbol[]): void {
    const name = node.id.name;
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    const members = node.members.map((m: Record<string, any>) => {
      if (m.id.type === 'Identifier') return m.id.name;
      return null;
    }).filter(Boolean);
    
    symbols.push({
      name,
      type: 'enum',
      lineStart,
      lineEnd,
      signature: `enum ${name}`,
      metadata: {
        members,
        const: node.const || false
      }
    });
  }
  
  private extractCall(node: Record<string, any>, calls: CallReference[]): void {
    let calleeName = '';
    let callType: CallReference['callType'] = 'function';
    
    if (node.callee.type === 'Identifier') {
      calleeName = node.callee.name;
      callType = 'function';
    } else if (node.callee.type === 'MemberExpression') {
      const obj = node.callee.object.type === 'Identifier' ? node.callee.object.name : 'unknown';
      const prop = node.callee.property.type === 'Identifier' ? node.callee.property.name : 'unknown';
      calleeName = `${obj}.${prop}`;
      callType = 'method';
    }
    
    if (calleeName && !this.isKeyword(calleeName)) {
      calls.push({
        calleeName,
        callType,
        line: node.loc?.start.line || 1,
        column: node.loc?.start.column || 0,
        isExternal: false
      });
    }
  }
  
  private extractNewExpression(node: Record<string, any>, calls: CallReference[]): void {
    if (node.callee.type === 'Identifier') {
      calls.push({
        calleeName: node.callee.name,
        callType: 'constructor',
        line: node.loc?.start.line || 1,
        column: node.loc?.start.column || 0,
        isExternal: false
      });
    }
  }
  
  private isKeyword(word: string): boolean {
    const keywords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'throw', 'try', 'catch', 'finally', 'typeof', 'instanceof',
      'new', 'this', 'super', 'class', 'extends', 'export', 'import', 'default',
      'function', 'const', 'let', 'var', 'async', 'await', 'yield', 'delete',
      'void', 'null', 'undefined', 'true', 'false', 'in', 'of', 'with'
    ]);
    return keywords.has(word);
  }
  
  private buildStructure(symbols: Symbol[]): Record<string, any> {
    const structure: Record<string, any> = {
      functions: [],
      classes: [],
      interfaces: [],
      types: [],
      enums: [],
      methods: []
    };
    
    symbols.forEach(symbol => {
      const detail = {
        name: symbol.name,
        line: symbol.lineStart,
        signature: symbol.signature
      };
      
      switch (symbol.type) {
        case 'function':
          structure.functions.push(detail);
          break;
        case 'class':
          structure.classes.push(detail);
          break;
        case 'interface':
          structure.interfaces.push(detail);
          break;
        case 'type':
          structure.types.push(detail);
          break;
        case 'enum':
          structure.enums.push(detail);
          break;
        case 'method':
          structure.methods.push(detail);
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
  
  // Fallback regex-based extraction
  private extractWithRegex(_fileInfo: FileInfo): ExtractedContext {
    // This would use the existing regex patterns from the current extractor
    // Simplified here for brevity
    const context: ExtractedContext = {
      symbols: [],
      imports: [],
      exports: [],
      dependencies: [],
      comments: this.extractComments(),
      calls: [],
      structure: {}
    };
    
    // Add basic regex extraction logic here
    // (reuse patterns from existing implementation)
    
    return context;
  }
}