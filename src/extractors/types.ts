/**
 * Type definitions for language extractors
 */

// Babel AST node types - simplified to avoid conflicts
export interface BabelNode {
  type: string;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  } | null;
  id?: BabelIdentifier | null;
  name?: string;
  params?: BabelNode[];
  body?: unknown; // Can be various types
  async?: boolean;
  generator?: boolean;
  static?: boolean;
  kind?: string;
  superClass?: BabelNode;
  extends?: unknown[];
  expression?: BabelNode;
  members?: unknown[];
  declaration?: BabelNode;
  specifiers?: BabelExportSpecifier[];
  source?: { value: string };
  callee?: BabelNode;
  object?: BabelNode;
  property?: BabelNode;
  argument?: BabelNode;
  exported?: BabelIdentifier;
  key?: BabelNode;
  abstract?: boolean;
  const?: boolean;
  typeAnnotation?: { typeAnnotation?: BabelTypeAnnotation };
  returnType?: { typeAnnotation?: BabelTypeAnnotation };
  [key: string]: unknown; // Allow additional properties
}

export interface BabelIdentifier extends BabelNode {
  type: 'Identifier';
  name: string;
}

export interface BabelBlockStatement {
  type: 'BlockStatement';
  body: BabelNode[];
}

export interface BabelExportSpecifier extends BabelNode {
  exported?: BabelIdentifier;
}

export interface BabelClassBody {
  body: BabelClassMember[];
}

export interface BabelClassMember {
  type: 'ClassMethod' | 'MethodDefinition' | 'ClassProperty' | 'PropertyDefinition';
  key: BabelNode;
  static?: boolean;
  async?: boolean;
  kind?: string;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  } | null;
}

export interface BabelTypeAnnotation {
  type: string;
  typeAnnotation?: BabelNode;
}

export interface BabelTSNode {
  type: string;
  id: BabelIdentifier;
  extends?: BabelTSExpressionWithTypeArguments[];
  body: unknown;
  members?: BabelTSEnumMember[];
  typeAnnotation?: BabelNode;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  } | null;
}

export interface BabelTSExpressionWithTypeArguments extends BabelNode {
  expression: BabelNode;
}

export interface BabelTSInterfaceBody {
  body: BabelTSPropertySignature[];
}

export interface BabelTSPropertySignature extends BabelNode {
  type: 'TSPropertySignature';
  key: BabelNode;
}

export interface BabelTSEnumMember {
  id: BabelNode;
}

// Tree-sitter node types
export interface TreeSitterNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  childCount: number;
  child(index: number): TreeSitterNode | null;
  [key: string]: unknown; // Allow additional properties
}

// Structure types
export interface SymbolDetail {
  name: string;
  line: number;
  signature: string;
}

export interface StructureCategory {
  [key: string]: SymbolDetail[];
}