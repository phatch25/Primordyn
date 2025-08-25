// Database query result types
export interface CountResult {
  count: number;
}

export interface SumResult {
  total: number | null;
}

export interface MaxResult<T = string> {
  last: T | null;
}

export interface FileStatResult {
  language: string;
  count: number;
}

export interface LargestFileResult {
  path: string;
  size: number;
  tokens: number;
}

export interface DuplicateGroupResult {
  signature_hash: string;
  duplicate_count: number;
  line_count: number;
  file_count: number;
}

export interface DuplicateSymbolResult {
  id: number;
  file_id: number;
  name: string;
  type: string;
  signature: string;
  line_start: number;
  line_end: number;
  path: string;
  relative_path: string;
}

export interface EndpointResult {
  method: string;
  path: string;
  handler: string | null;
  filePath: string;
  lineNumber: number;
}

export interface CircularDependencyResult {
  caller_file: string;
  called_file: string;
}

export interface PatternResult {
  pattern_type: string;
  pattern_signature: string;
  occurrence_count: number;
  pattern_examples: string;
}

export interface UnusedSymbolResult {
  id: number;
  name: string;
  type: string;
  file_path: string;
  line_start: number;
  line_end: number;
}

export interface ImpactQueryResult {
  symbol_id: number;
  symbol_name: string;
  symbol_type: string;
  file_path: string;
  line_start: number;
  line_end: number;
}

export interface CallGraphQueryResult {
  caller_symbol_id: number | null;
  caller_file_id: number;
  callee_name: string;
  line_number: number;
  caller_file_path: string;
}

export interface EndpointQueryRow {
  name: string;
  type: string;
  signature: string | null;
  line_start: number;
  metadata: string | null;
  file_path: string;
}

export interface TargetSymbolResult {
  id: number;
  name: string;
  type: string;
  signature: string | null;
  line_start: number;
  line_end: number;
  file_id: number;
  relative_path: string;
  file_path: string;
}

export interface TextSearchResult {
  file_path: string;
  relative_path: string;
  content: string;
}

export interface BreakingChangeResult {
  callers: number;
}

export interface DuplicateSymbolQueryResult {
  name: string;
  type: string;
  file_path: string;
  relative_path: string;
  line_start: number;
  line_end: number;
  content: string;
  line_count: number;
}

export interface UnusedSymbolQueryResult {
  id: number;
  file_id: number;
  name: string;
  type: string;
  line_start: number;
  line_end: number;
  signature: string | null;
  documentation: string | null;
  metadata: string | null;
  relative_path: string;
  file_path: string;
  language: string;
  line_count: number;
  is_exported: 0 | 1;
}

export interface PatternTargetSymbol {
  id: number;
  file_id: number;
  name: string;
  type: string;
  line_start: number;
  line_end: number;
  signature: string | null;
  documentation: string | null;
  metadata: string | null;
  relative_path: string;
  file_path: string;
  file_content: string;
}

export interface PatternCandidate {
  id: number;
  name: string;
  type: string;
  line_start: number;
  line_end: number;
  file_path: string;
  relative_path: string;
  file_content: string;
}

export interface GraphDependency {
  name: string;
  type: string;
  id: number;
  signature: string | null;
  line_start: number;
  file: string;
  file_path: string;
  call_count: number;
}