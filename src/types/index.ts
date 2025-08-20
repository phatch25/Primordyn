export interface FileInfo {
  path: string;
  relativePath: string;
  content: string;
  hash: string;
  size: number;
  language: string | null;
  lastModified: Date;
}

export interface ScanOptions {
  rootPath: string;
  ignorePatterns?: string[];
  includePatterns?: string[];
  maxFileSize?: number;
  followSymlinks?: boolean;
}

export interface Symbol {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'constant' | 'export' | 'import' | 'method' | 'property' | 'namespace' | 'module' | 'struct' | 'enum' | 'trait';
  lineStart: number;
  lineEnd: number;
  signature?: string;
  documentation?: string;
  metadata?: Record<string, any>;
}

export interface CallReference {
  calleeName: string;
  callType: 'function' | 'method' | 'constructor' | 'import';
  line: number;
  column?: number;
  isExternal?: boolean;
}

export interface ExtractedContext {
  symbols: Symbol[];
  imports: string[];
  exports: string[];
  dependencies: string[];
  comments: string[];
  calls: CallReference[];
  structure: any;
}

export interface IndexOptions extends Partial<ScanOptions> {
  projectRoot?: string;
  verbose?: boolean;
  languages?: string[];
  updateExisting?: boolean;
}

export interface IndexStats {
  filesIndexed: number;
  symbolsExtracted: number;
  totalTokens: number;
  timeElapsed: number;
  errors: number;
}

export interface QueryOptions {
  maxTokens?: number;
  includeContent?: boolean;
  includeSymbols?: boolean;
  includeImports?: boolean;
  fileTypes?: string[];
  sortBy?: 'relevance' | 'path' | 'size' | 'modified';
}

export interface QueryResult {
  files: FileResult[];
  symbols: SymbolResult[];
  totalTokens: number;
  truncated: boolean;
  query_type?: 'search' | 'related';
  source_file?: string;
}

export interface FileResult {
  id: number;
  path: string;
  relativePath: string;
  language: string | null;
  content?: string;
  preview?: string;
  tokens: number;
  symbols?: SymbolResult[];
  imports?: string[];
  exports?: string[];
  metadata?: any;
}

export interface SymbolResult {
  id: number;
  name: string;
  type: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  signature?: string;
  content?: string;
}

export interface DatabaseInfo {
  fileCount: number;
  symbolCount: number;
  totalSize: number;
  lastIndexed: Date | null;
}

export interface CallGraphNode {
  symbolId?: number;
  fileId: number;
  name: string;
  type: string;
  filePath: string;
  line: number;
}

export interface CallGraphEdge {
  from: CallGraphNode;
  to: CallGraphNode;
  callType: string;
  line: number;
}

export interface DependencyGraph {
  root: CallGraphNode;
  calls: CallGraphEdge[];
  calledBy: CallGraphEdge[];
}