import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
// Handle ESM/CJS compatibility for @babel/traverse
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse = (_traverse as any)?.default || _traverse;
import { BaseExtractor } from './base.js';
import type { FileInfo, ExtractedContext, Symbol, CallReference } from '../types/index.js';
import type { 
  BabelNode, 
  BabelIdentifier, 
  BabelClassMember, 
  BabelTSNode, 
  BabelTSPropertySignature,
  BabelTSEnumMember,
  BabelTSExpressionWithTypeArguments,
  BabelExportSpecifier,
  StructureCategory
} from './types.js';

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
        attachComment: true,  // Attach comments to AST nodes
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
        FunctionDeclaration: (path: NodePath) => {
          this.extractFunction(path.node as unknown as BabelNode, context.symbols);
        },
        FunctionExpression: (path: NodePath) => {
          if (path.parent.type === 'VariableDeclarator' && path.parent.id.type === 'Identifier') {
            this.extractFunction(path.node as unknown as BabelNode, context.symbols, path.parent.id.name);
          }
        },
        ArrowFunctionExpression: (path: NodePath) => {
          if (path.parent.type === 'VariableDeclarator' && path.parent.id.type === 'Identifier') {
            this.extractArrowFunction(path.node as unknown as BabelNode, context.symbols, path.parent.id.name);
          }
        },
        ClassDeclaration: (path: NodePath) => {
          this.extractClass(path.node as unknown as BabelNode, context.symbols);
        },
        ClassExpression: (path: NodePath) => {
          if (path.parent.type === 'VariableDeclarator' && path.parent.id.type === 'Identifier') {
            this.extractClass(path.node as unknown as BabelNode, context.symbols, path.parent.id.name);
          }
        },
        TSInterfaceDeclaration: (path: NodePath) => {
          this.extractInterface(path.node as unknown as BabelTSNode, context.symbols);
        },
        TSTypeAliasDeclaration: (path: NodePath) => {
          this.extractTypeAlias(path.node as unknown as BabelTSNode, context.symbols);
        },
        TSEnumDeclaration: (path: NodePath) => {
          this.extractEnum(path.node as unknown as BabelTSNode, context.symbols);
        },
        ImportDeclaration: (path: NodePath) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const node = path.node as any;
          const source = node.source?.value;
          if (source) {
            context.imports.push(source);
            context.dependencies.push(source);
          }
        },
        ExportNamedDeclaration: (path: NodePath) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const node = path.node as any;
          if (node.declaration) {
            const decl = node.declaration;
            if ('id' in decl && decl.id && 'name' in decl.id) {
              context.exports.push(decl.id.name);
            }
          }
          if (node.specifiers) {
            (node.specifiers as unknown as BabelExportSpecifier[]).forEach((spec: BabelExportSpecifier) => {
              if (spec.exported && 'name' in spec.exported) {
                context.exports.push(spec.exported.name);
              }
            });
          }
        },
        ExportDefaultDeclaration: () => {
          context.exports.push('default');
        },
        CallExpression: (path: NodePath) => {
          this.extractCall(path.node as unknown as BabelNode, context.calls);
        },
        NewExpression: (path: NodePath) => {
          this.extractNewExpression(path.node as unknown as BabelNode, context.calls);
        }
      });
      
      // Extract comments
      if ('comments' in ast && Array.isArray(ast.comments)) {
        context.comments = ast.comments.map((comment: { value: string }) => comment.value);
      }
      
      // Build structure
      context.structure = this.buildStructure(context.symbols);
      
    } catch {
      // Fallback to regex-based extraction if AST parsing fails
      return this.extractWithRegex(fileInfo);
    }
    
    return context;
  }
  
  private extractFunction(node: BabelNode, symbols: Symbol[], name?: string): void {
    const functionName = name || node.id?.name;
    if (!functionName) return;
    
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    // Extract JSDoc comments
    const documentation = this.extractJSDoc(node);
    
    const params = (node.params || []).map((p: BabelNode) => {
      if (p.type === 'Identifier') {
        // Include type annotation if available
        const typeAnnotation = (p as any).typeAnnotation;
        if (typeAnnotation?.typeAnnotation) {
          const typeStr = this.getTypeString(typeAnnotation.typeAnnotation);
          return `${p.name}: ${typeStr}`;
        }
        return p.name;
      }
      if (p.type === 'RestElement' && p.argument && p.argument.type === 'Identifier') {
        const typeAnnotation = (p.argument as any).typeAnnotation;
        if (typeAnnotation?.typeAnnotation) {
          const typeStr = this.getTypeString(typeAnnotation.typeAnnotation);
          return `...${p.argument.name}: ${typeStr}`;
        }
        return `...${p.argument.name}`;
      }
      return '...';
    }).join(', ');
    
    // Include return type if available
    const returnType = (node as any).returnType?.typeAnnotation;
    const returnTypeStr = returnType ? `: ${this.getTypeString(returnType)}` : '';
    
    const signature = `${node.async ? 'async ' : ''}function ${functionName}(${params})${returnTypeStr}`;
    
    symbols.push({
      name: functionName,
      type: 'function',
      lineStart,
      lineEnd,
      signature,
      documentation,
      metadata: {
        async: node.async || false,
        generator: node.generator || false,
        params: node.params?.length || 0
      }
    });
  }
  
  private extractArrowFunction(node: BabelNode, symbols: Symbol[], name: string): void {
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    const params = (node.params || []).map((p: BabelNode) => {
      if (p.type === 'Identifier') {
        const typeAnnotation = (p as any).typeAnnotation;
        if (typeAnnotation?.typeAnnotation) {
          const typeStr = this.getTypeString(typeAnnotation.typeAnnotation);
          return `${p.name}: ${typeStr}`;
        }
        return p.name;
      }
      if (p.type === 'RestElement' && p.argument && p.argument.type === 'Identifier') {
        const typeAnnotation = (p.argument as any).typeAnnotation;
        if (typeAnnotation?.typeAnnotation) {
          const typeStr = this.getTypeString(typeAnnotation.typeAnnotation);
          return `...${p.argument.name}: ${typeStr}`;
        }
        return `...${p.argument.name}`;
      }
      return '...';
    }).join(', ');
    
    // Include return type if available
    const returnType = (node as any).returnType?.typeAnnotation;
    const returnTypeStr = returnType ? `: ${this.getTypeString(returnType)}` : '';
    
    const signature = `const ${name} = ${node.async ? 'async ' : ''}(${params})${returnTypeStr} => ...`;
    
    symbols.push({
      name,
      type: 'function',
      lineStart,
      lineEnd,
      signature,
      metadata: {
        async: node.async || false,
        arrow: true,
        params: node.params?.length || 0
      }
    });
  }
  
  private extractClass(node: BabelNode, symbols: Symbol[], name?: string): void {
    const className = name || node.id?.name;
    if (!className) return;
    
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    // Extract JSDoc comments
    const documentation = this.extractJSDoc(node);
    
    let signature = `class ${className}`;
    if (node.superClass) {
      const superName = node.superClass.type === 'Identifier' ? node.superClass.name : 'unknown';
      signature += ` extends ${superName}`;
    }
    
    const methods: string[] = [];
    const properties: string[] = [];
    
    const classBody = node.body as { body: BabelClassMember[] };
    classBody.body.forEach((member: BabelClassMember) => {
      if (member.type === 'ClassMethod' || member.type === 'MethodDefinition') {
        const methodName = member.key && member.key.type === 'Identifier' && member.key.name ? member.key.name : 'unknown';
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
        const propName = member.key && member.key.type === 'Identifier' && member.key.name ? member.key.name : 'unknown';
        properties.push(propName);
      }
    });
    
    symbols.push({
      name: className,
      type: 'class',
      lineStart,
      lineEnd,
      signature,
      documentation,
      metadata: {
        extends: node.superClass ? true : false,
        methods,
        properties,
        abstract: node.abstract || false
      }
    });
  }
  
  private extractInterface(node: BabelTSNode, symbols: Symbol[]): void {
    const name = node.id.name;
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    let signature = `interface ${name}`;
    if (node.extends && node.extends.length > 0) {
      const extendsList = node.extends.map((e: BabelTSExpressionWithTypeArguments) => 
        (e.expression as BabelIdentifier).name
      ).join(', ');
      signature += ` extends ${extendsList}`;
    }
    
    const interfaceBody = node.body as { body: BabelTSPropertySignature[] };
    const properties = interfaceBody.body.map((prop: BabelTSPropertySignature) => {
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
  
  private extractTypeAlias(node: BabelTSNode, symbols: Symbol[]): void {
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
  
  private extractEnum(node: BabelTSNode, symbols: Symbol[]): void {
    const name = node.id.name;
    const lineStart = node.loc?.start.line || 1;
    const lineEnd = node.loc?.end.line || lineStart;
    
    const members = (node.members || []).map((m: BabelTSEnumMember) => {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const: (node as any).const || false
      }
    });
  }
  
  private extractCall(node: BabelNode, calls: CallReference[]): void {
    if (!node.callee) return;
    
    let calleeName = '';
    let callType: CallReference['callType'] = 'function';
    
    if (node.callee.type === 'Identifier') {
      calleeName = node.callee.name || '';
      callType = 'function';
    } else if (node.callee.type === 'MemberExpression') {
      const obj = node.callee.object && node.callee.object.type === 'Identifier' && node.callee.object.name ? node.callee.object.name : 'unknown';
      const prop = node.callee.property && node.callee.property.type === 'Identifier' && node.callee.property.name ? node.callee.property.name : 'unknown';
      calleeName = `${obj}.${prop}`;
      callType = 'method';
    }
    
    if (calleeName && !this.isKeyword(calleeName)) {
      calls.push({
        calleeName: calleeName || '',
        callType,
        line: node.loc?.start.line || 1,
        column: node.loc?.start.column || 0,
        isExternal: false
      });
    }
  }
  
  private extractNewExpression(node: BabelNode, calls: CallReference[]): void {
    if (!node.callee) return;
    
    if (node.callee.type === 'Identifier' && node.callee.name) {
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
  
  private buildStructure(symbols: Symbol[]): StructureCategory {
    const structure: StructureCategory = {
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
        signature: symbol.signature || ''
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
  
  private getTypeString(typeAnnotation: any): string {
    if (!typeAnnotation) return 'any';
    
    switch (typeAnnotation.type) {
      case 'TSStringKeyword':
        return 'string';
      case 'TSNumberKeyword':
        return 'number';
      case 'TSBooleanKeyword':
        return 'boolean';
      case 'TSAnyKeyword':
        return 'any';
      case 'TSUnknownKeyword':
        return 'unknown';
      case 'TSVoidKeyword':
        return 'void';
      case 'TSNullKeyword':
        return 'null';
      case 'TSUndefinedKeyword':
        return 'undefined';
      case 'TSArrayType':
        return `${this.getTypeString(typeAnnotation.elementType)}[]`;
      case 'TSTypeReference':
        if (typeAnnotation.typeName?.type === 'Identifier') {
          const typeName = typeAnnotation.typeName.name;
          if (typeAnnotation.typeParameters?.params?.length > 0) {
            const params = typeAnnotation.typeParameters.params
              .map((p: any) => this.getTypeString(p))
              .join(', ');
            return `${typeName}<${params}>`;
          }
          return typeName;
        }
        return 'unknown';
      case 'TSUnionType':
        return typeAnnotation.types
          .map((t: any) => this.getTypeString(t))
          .join(' | ');
      case 'TSIntersectionType':
        return typeAnnotation.types
          .map((t: any) => this.getTypeString(t))
          .join(' & ');
      case 'TSFunctionType':
        return 'Function';
      case 'TSTypeLiteral':
        return 'object';
      default:
        return 'any';
    }
  }
  
  private extractJSDoc(node: any): string | undefined {
    // Check for leading comments (JSDoc typically appears before the node)
    const leadingComments = node.leadingComments;
    if (!leadingComments || leadingComments.length === 0) {
      return undefined;
    }
    
    // Find JSDoc comments (start with /** )
    const jsdocComment = leadingComments.find((comment: any) => 
      comment.type === 'CommentBlock' && comment.value.startsWith('*')
    );
    
    if (!jsdocComment) {
      return undefined;
    }
    
    // Clean up the JSDoc comment
    const lines = jsdocComment.value.split('\n');
    const cleanedLines = lines.map((line: string) => {
      // Remove leading asterisks and spaces
      return line.replace(/^\s*\*\s?/, '').trim();
    }).filter((line: string) => line.length > 0);
    
    // Join lines and limit length
    const documentation = cleanedLines.join(' ');
    return documentation.length > 500 ? documentation.substring(0, 497) + '...' : documentation;
  }
}