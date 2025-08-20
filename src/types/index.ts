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
  metadata?: Record<string, unknown>;
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
  structure: Record<string, unknown>;
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
  metadata?: Record<string, unknown>;
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

export interface ImpactAnalysis {
  symbol: string;
  type: string;
  location: string;
  
  // Direct impact
  directReferences: number;
  filesAffected: number;
  symbolsAffected: number;
  
  // Test impact
  testsAffected: number;
  testFiles: string[];
  
  // Breakdown by file type
  impactByType: {
    implementation: number;
    tests: number;
    configs: number;
    other: number;
  };
  
  // Risk assessment
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskFactors: string[];
  
  // Detailed affected files
  affectedFiles: {
    path: string;
    referenceCount: number;
    isTest: boolean;
    lines: number[];
  }[];
  
  // Suggestions
  suggestions: string[];
}

export interface GitCommit {
  hash: string;
  author: string;
  email: string;
  date: Date;
  message: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface GitFileChange {
  commit: GitCommit;
  filePath: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  insertions: number;
  deletions: number;
  oldPath?: string; // For renames
}

export interface GitBlame {
  line: number;
  commit: GitCommit;
  content: string;
}

export interface GitHistory {
  symbol: string;
  filePath: string;
  
  // Recent commits affecting this symbol/file
  recentCommits: GitCommit[];
  
  // File-level changes
  fileChanges: GitFileChange[];
  
  // Line-by-line blame for symbol location
  blame: GitBlame[];
  
  // Statistics
  totalCommits: number;
  uniqueAuthors: string[];
  lastModified: Date;
  firstSeen: Date;
  
  // Change frequency analysis
  changeFrequency: {
    last7Days: number;
    last30Days: number;
    last90Days: number;
  };
  
  // Related changes (files often changed together)
  relatedFiles: {
    path: string;
    coChangeCount: number;
  }[];
}

// Command line options interfaces
export interface QueryCommandOptions {
  tokens: string;
  format: 'ai' | 'json' | 'human';
  depth: string;
  includeTests?: boolean;
  includeCallers?: boolean;
  showGraph?: boolean;
  impact?: boolean;
  recent?: string;
  blame?: boolean;
  languages?: string;
}

export interface FindCommandOptions {
  includeContent?: boolean;
  format: 'ai' | 'json' | 'human';
  type?: string;
}

export interface RelatedCommandOptions {
  includeContent?: boolean;
  tokens: string;
  depth: string;
}

export interface StatsCommandOptions {
  json?: boolean;
}

// Recent changes type
export interface RecentFileChanges {
  file: string;
  commits: GitCommit[];
}

// Query result interface
export interface QueryCommandResult {
  primarySymbol: SymbolResult | null;
  allSymbols: SymbolResult[];
  files: FileResult[];
  usages: FileResult[];
  dependencyGraph: DependencyGraph | null;
  impactAnalysis: ImpactAnalysis | null;
  gitHistory: GitHistory | null;
  recentChanges: RecentFileChanges[] | null;
  totalTokens: number;
  truncated: boolean;
}

// Database row types
export interface FileRow {
  id: number;
  path: string;
  relative_path: string;
  content: string;
  hash: string;
  size: number;
  language: string | null;
  last_modified: string;
  indexed_at: string;
  metadata: string | null;
}

export interface SymbolRow {
  id: number;
  file_id: number;
  name: string;
  type: string;
  line_start: number;
  line_end: number;
  signature: string | null;
  documentation: string | null;
  metadata: string | null;
}