import { PrimordynDB } from '../database/index.js';
import { encodingForModel, Tiktoken } from 'js-tiktoken';
import { GitAnalyzer } from '../git/analyzer.js';
import { LRUCache } from '../utils/lru-cache.js';
import Fuse from 'fuse.js';
import type { 
  QueryOptions, QueryResult, FileResult, SymbolResult, 
  DependencyGraph, CallGraphNode, CallGraphEdge, ImpactAnalysis, GitHistory, 
  FileQueryRow, SymbolQueryRow, RecentFileChanges, FileReferenceRow,
  MetadataResult, SymbolWithFileContent, CallGraphResult,
  CallerResult, SymbolLookupResult, FilePathResult
} from '../types/index.js';

export class ContextRetriever {
  private db: PrimordynDB;
  private tokenEncoder: Tiktoken;
  private gitAnalyzer: GitAnalyzer;
  private queryCache: LRUCache<QueryResult>;
  private symbolCache: LRUCache<SymbolResult[]>;
  private fileCache: LRUCache<FileResult>;

  constructor(db: PrimordynDB) {
    this.db = db;
    // Use GPT-4 encoder as it's similar to Claude's tokenization
    this.tokenEncoder = encodingForModel('gpt-4');
    this.gitAnalyzer = new GitAnalyzer();
    
    // Initialize caches with 30 second TTL
    this.queryCache = new LRUCache<QueryResult>(100, 30);
    this.symbolCache = new LRUCache<SymbolResult[]>(200, 30);
    this.fileCache = new LRUCache<FileResult>(100, 30);
  }

  public async query(searchTerm: string, options: QueryOptions = {}): Promise<QueryResult> {
    // Generate cache key
    const cacheKey = `query:${searchTerm}:${JSON.stringify(options)}`;
    
    // Check cache first
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    const maxTokens = options.maxTokens || 4000;
    const database = this.db.getDatabase();

    const result: QueryResult = {
      files: [],
      symbols: [],
      totalTokens: 0,
      truncated: false
    };

    // First check if the search term looks like a file path
    const isFilePathSearch = this.looksLikeFilePath(searchTerm);
    
    let files: FileQueryRow[] = [];
    let symbols: SymbolQueryRow[] = [];
    
    if (isFilePathSearch) {
      // Specialized file path search
      files = await this.searchByFilePath(searchTerm, options);
    } else {
      // Check if we can use FTS5 or need to fall back to LIKE
      const escapedTerm = this.escapeFTS5(searchTerm);
      const useFTS = escapedTerm.length > 0 && escapedTerm !== '';
      
      if (useFTS) {
        // Use FTS for better search
        const fileQuery = this.buildFileQuery(escapedTerm, options);
        files = database.prepare(fileQuery).all({ searchTerm: escapedTerm }) as FileQueryRow[];

        // Search in symbols using FTS
        const symbolQuery = this.buildSymbolQuery(escapedTerm, options);
        symbols = database.prepare(symbolQuery).all({ searchTerm: escapedTerm }) as SymbolQueryRow[];
      } else {
        // Fall back to LIKE queries for special characters or OR queries
        const fileQuery = this.buildFileLikeQuery(searchTerm, options);
        
        // Build params based on whether it's an OR query
        const params: string[] = [];
        if (searchTerm.includes(' OR ')) {
          const terms = searchTerm.split(/\s+OR\s+/i);
          terms.forEach(term => {
            params.push(`%${term.trim()}%`, `%${term.trim()}%`);
          });
        } else {
          params.push(`%${searchTerm}%`, `%${searchTerm}%`);
        }
        
        if (options.fileTypes?.length) {
          params.push(...options.fileTypes);
        }
        files = database.prepare(fileQuery).all(...params) as FileQueryRow[];
        
        const symbolQuery = this.buildSymbolLikeQuery(searchTerm, options);
        const symbolParams: string[] = [];
        
        // Build symbol params based on whether it's an OR query
        if (searchTerm.includes(' OR ')) {
          const terms = searchTerm.split(/\s+OR\s+/i);
          terms.forEach(term => {
            symbolParams.push(`%${term.trim()}%`, `%${term.trim()}%`, `%${term.trim()}%`);
          });
        } else {
          symbolParams.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
        }
        
        if (options.fileTypes?.length) {
          symbolParams.push(...options.fileTypes);
        }
        
        // Add parameters for ORDER BY (only for non-OR queries)
        if (!searchTerm.includes(' OR ')) {
          const hasMultipleWords = searchTerm.trim().split(/\s+/).length > 1;
          if (hasMultipleWords) {
            symbolParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
          } else {
            symbolParams.push(searchTerm, `%${searchTerm}%`);
          }
        }
        
        symbols = database.prepare(symbolQuery).all(...symbolParams) as SymbolQueryRow[];
      }
    }
    
    // Apply fuzzy matching if results are limited or for typo tolerance
    if (symbols.length < 5 && searchTerm.length > 2 && !isFilePathSearch) {
      const fuzzySymbols = await this.fuzzySearchSymbols(searchTerm, options);
      // Merge fuzzy results with existing ones, avoiding duplicates
      const existingIds = new Set(symbols.map(s => s.id));
      for (const fuzzySymbol of fuzzySymbols) {
        if (!existingIds.has(fuzzySymbol.id)) {
          symbols.push(fuzzySymbol);
          if (symbols.length >= 20) break; // Limit fuzzy results
        }
      }
    }
    
    // Also apply fuzzy matching for files if few results found
    if (files.length < 3 && searchTerm.length > 2) {
      const fuzzyFiles = await this.fuzzySearchFiles(searchTerm, options);
      // Merge fuzzy results with existing ones, avoiding duplicates
      const existingIds = new Set(files.map(f => f.id));
      for (const fuzzyFile of fuzzyFiles) {
        if (!existingIds.has(fuzzyFile.id)) {
          files.push(fuzzyFile);
          if (files.length >= 10) break; // Limit fuzzy results
        }
      }
    }

    // Sort and prioritize results for better relevance
    const prioritizedFiles = this.prioritizeResults(files, searchTerm);
    const prioritizedSymbols = this.prioritizeSymbolResults(symbols, searchTerm);
    
    // Process results with token limit
    for (const file of prioritizedFiles) {
      const fileResult = await this.processFileResult(file, options);
      const fileTokens = this.estimateTokens(fileResult);

      if (result.totalTokens + fileTokens > maxTokens) {
        result.truncated = true;
        break;
      }

      result.files.push(fileResult);
      result.totalTokens += fileTokens;
    }

    for (const symbol of prioritizedSymbols) {
      const symbolResult = this.processSymbolResult(symbol);
      const symbolTokens = this.estimateTokens(symbolResult);

      if (result.totalTokens + symbolTokens > maxTokens) {
        result.truncated = true;
        break;
      }

      result.symbols.push(symbolResult);
      result.totalTokens += symbolTokens;
    }

    // Cache the result before returning
    this.queryCache.set(cacheKey, result);
    
    return result;
  }

  public async getFileContext(filePath: string, options: QueryOptions = {}): Promise<FileResult | null> {
    const database = this.db.getDatabase();
    
    const file = database.prepare(`
      SELECT id, path, relative_path as relativePath, content, language, metadata
      FROM files
      WHERE path = ? OR relative_path = ?
    `).get(filePath, filePath) as FileQueryRow | undefined;

    if (!file) {
      return null;
    }

    return this.processFileResult(file, options);
  }

  public async getRelatedFiles(filePath: string, options: QueryOptions = {}): Promise<FileResult[]> {
    const maxTokens = options.maxTokens || 4000;
    const database = this.db.getDatabase();

    // Get imports from the target file
    const fileData = database.prepare(`
      SELECT metadata FROM files WHERE path = ? OR relative_path = ?
    `).get(filePath, filePath) as MetadataResult | undefined;

    if (!fileData || !fileData.metadata) {
      return [];
    }

    const metadata = JSON.parse(fileData.metadata);
    const imports = metadata.imports || [];
    const results: FileResult[] = [];
    let totalTokens = 0;

    // Find files that are imported
    for (const importPath of imports) {
      const relatedFiles = database.prepare(`
        SELECT id, path, relative_path as relativePath, content, language, metadata, hash, size, last_modified, indexed_at
        FROM files
        WHERE relative_path LIKE ?
        LIMIT 5
      `).all(`%${importPath}%`) as FileQueryRow[];

      for (const file of relatedFiles) {
        const fileResult = await this.processFileResult(file, options);
        const fileTokens = this.estimateTokens(fileResult);

        if (totalTokens + fileTokens > maxTokens) {
          break;
        }

        results.push(fileResult);
        totalTokens += fileTokens;
      }
    }

    return results;
  }

  public async findUsages(symbolName: string, options: QueryOptions = {}): Promise<FileResult[]> {
    const database = this.db.getDatabase();
    const maxTokens = options.maxTokens || 4000;
    
    // First, try to find actual call graph references
    const callGraphQuery = `
      SELECT DISTINCT
        f.id,
        f.path,
        f.relative_path as relativePath,
        f.content,
        f.language,
        f.metadata,
        f.size,
        f.last_modified as lastModified,
        cg.line_number as callLine,
        cg.call_type as callType
      FROM call_graph cg
      JOIN files f ON cg.caller_file_id = f.id
      WHERE cg.callee_name = ?
      ORDER BY f.relative_path
      LIMIT 20
    `;
    
    const callGraphResults = database.prepare(callGraphQuery).all(symbolName) as Array<FileQueryRow & { callLine: number; callType: string }>;
    
    // If we have call graph results, use those
    if (callGraphResults.length > 0) {
      const results: FileResult[] = [];
      let totalTokens = 0;
      const fileMap = new Map<number, { file: FileQueryRow; calls: Array<{ line: number; type: string }> }>();
      
      // Group calls by file
      for (const result of callGraphResults) {
        if (!fileMap.has(result.id)) {
          fileMap.set(result.id, { 
            file: result, 
            calls: [] 
          });
        }
        fileMap.get(result.id)!.calls.push({ 
          line: result.callLine, 
          type: result.callType 
        });
      }
      
      // Process each file with its calls
      for (const { file, calls } of fileMap.values()) {
        const fileResult = await this.processFileResult(file, options);
        fileResult.metadata = { 
          actualCalls: calls,
          callCount: calls.length 
        };
        
        const fileTokens = this.estimateTokens(fileResult);
        if (totalTokens + fileTokens > maxTokens) {
          break;
        }
        
        results.push(fileResult);
        totalTokens += fileTokens;
      }
      
      return results;
    }
    
    // Fall back to text-based search if no call graph data
    const query = `
      SELECT DISTINCT
        f.id,
        f.path,
        f.relative_path as relativePath,
        f.content,
        f.language,
        f.metadata,
        f.size,
        f.last_modified as lastModified
      FROM files f
      WHERE 
        -- Check in file content (excluding the definition file)
        f.content LIKE '%' || ? || '%'
        AND f.id NOT IN (
          SELECT DISTINCT file_id 
          FROM symbols 
          WHERE name = ?
        )
      ${options.fileTypes?.length ? `AND f.language IN (${options.fileTypes.map(() => '?').join(',')})` : ''}
      ORDER BY 
        CASE 
          WHEN f.relative_path LIKE '%test%' THEN 1
          WHEN f.relative_path LIKE '%spec%' THEN 1
          ELSE 0
        END,
        f.relative_path
      LIMIT 20
    `;
    
    const params = [symbolName, symbolName];
    if (options.fileTypes?.length) {
      params.push(...options.fileTypes);
    }
    
    const files = database.prepare(query).all(...params) as FileQueryRow[];
    const results: FileResult[] = [];
    let totalTokens = 0;
    
    for (const file of files) {
      // Check if the file actually uses the symbol (not just mentions in comments)
      const lines = file.content.split('\n');
      const usageLines: number[] = [];
      
      lines.forEach((line: string, index: number) => {
        // Look for actual usage patterns
        if (
          line.includes(`new ${symbolName}`) ||  // Class instantiation
          line.includes(`${symbolName}(`) ||      // Function call
          line.includes(`${symbolName}.`) ||      // Static method/property
          line.includes(`<${symbolName}`) ||      // JSX/Type usage
          line.includes(`: ${symbolName}`) ||     // Type annotation
          line.includes(`extends ${symbolName}`) || // Inheritance
          line.includes(`implements ${symbolName}`) || // Interface implementation
          line.includes(`from '.*${symbolName}`) || // Import
          line.includes(`import.*${symbolName}`)    // Import
        ) {
          usageLines.push(index + 1);
        }
      });
      
      if (usageLines.length > 0) {
        const fileResult = await this.processFileResult(file, options);
        fileResult.metadata = { usageLines };
        
        const fileTokens = this.estimateTokens(fileResult);
        if (totalTokens + fileTokens > maxTokens) {
          break;
        }
        
        results.push(fileResult);
        totalTokens += fileTokens;
      }
    }
    
    return results;
  }
  
  public async findSymbol(symbolName: string, options: QueryOptions = {}): Promise<SymbolResult[]> {
    // Check cache first
    const cacheKey = `symbol:${symbolName}:${JSON.stringify(options)}`;
    const cached = this.symbolCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    const database = this.db.getDatabase();

    // Check if we can use FTS5 or need to fall back to LIKE
    const escapedName = this.escapeFTS5(symbolName);
    const useFTS = escapedName.length > 0 && escapedName !== '';
    
    let symbols: SymbolQueryRow[];
    
    if (useFTS) {
      // Use FTS for symbol search
      const query = `
        SELECT 
          s.id,
          s.name,
          s.type,
          s.line_start as lineStart,
          s.line_end as lineEnd,
          s.signature,
          f.relative_path as filePath,
          f.content as fileContent
        FROM symbols_fts fts
        JOIN symbols s ON fts.rowid = s.id
        JOIN files f ON s.file_id = f.id
        WHERE symbols_fts MATCH ?
        ${options.symbolType ? `AND s.type = '${options.symbolType}'` : ''}
        ${options.fileTypes?.length ? `AND f.language IN (${options.fileTypes.map(() => '?').join(',')})` : ''}
        ORDER BY 
          bm25(symbols_fts),
          CASE WHEN LOWER(s.name) = LOWER(?) THEN 0 ELSE 1 END,
          LENGTH(s.name)
        LIMIT 20
      `;

      const params = [escapedName, escapedName];
      if (options.fileTypes?.length) {
        params.push(...options.fileTypes);
      }

      symbols = database.prepare(query).all(...params) as SymbolQueryRow[];
    } else {
      // Fall back to LIKE query for special characters
      const query = `
        SELECT 
          s.id,
          s.name,
          s.type,
          s.line_start as lineStart,
          s.line_end as lineEnd,
          s.signature,
          f.relative_path as filePath,
          f.content as fileContent
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE LOWER(s.name) LIKE LOWER(?)
        ${options.symbolType ? `AND s.type = '${options.symbolType}'` : ''}
        ${options.fileTypes?.length ? `AND f.language IN (${options.fileTypes.map(() => '?').join(',')})` : ''}
        ORDER BY 
          CASE WHEN LOWER(s.name) = LOWER(?) THEN 0 ELSE 1 END,
          LENGTH(s.name)
        LIMIT 20
      `;

      const params = [`%${symbolName}%`, symbolName];
      if (options.fileTypes?.length) {
        params.push(...options.fileTypes);
      }

      symbols = database.prepare(query).all(...params) as SymbolQueryRow[];
    }

    const results = symbols.map(symbol => this.processSymbolResult(symbol));
    
    // Cache the results
    this.symbolCache.set(cacheKey, results);
    
    return results;
  }

  public async searchFullText(query: string, options: QueryOptions = {}): Promise<QueryResult> {
    const maxTokens = options.maxTokens || 4000;
    const database = this.db.getDatabase();

    const result: QueryResult = {
      files: [],
      symbols: [],
      totalTokens: 0,
      truncated: false
    };

    // Check if we can use FTS5 or need to fall back to LIKE
    const escapedQuery = this.escapeFTS5(query);
    const useFTS = escapedQuery.length > 0 && escapedQuery !== '';
    
    let files: FileQueryRow[];
    let symbols: SymbolQueryRow[];
    
    if (useFTS) {
      // Search files using FTS
      const fileQuery = `
        SELECT 
          f.id, 
          f.path, 
          f.relative_path as relativePath, 
          f.content, 
          f.language, 
          f.metadata,
          f.size,
          f.last_modified as lastModified,
          snippet(files_fts, 1, '<mark>', '</mark>', '...', 32) as snippet
        FROM files_fts fts
        JOIN files f ON fts.rowid = f.id
        WHERE files_fts MATCH ?
        ${options.fileTypes?.length ? `AND f.language IN (${options.fileTypes.map(t => `'${t}'`).join(',')})` : ''}
        ORDER BY bm25(files_fts)
        LIMIT 10
      `;

      files = database.prepare(fileQuery).all(escapedQuery) as FileQueryRow[];

      // Search symbols using FTS
      const symbolQuery = `
        SELECT 
          s.id,
          s.name,
          s.type,
          s.line_start as lineStart,
          s.line_end as lineEnd,
          s.signature,
          f.relative_path as filePath,
          f.content as fileContent,
          snippet(symbols_fts, 0, '<mark>', '</mark>', '...', 16) as snippet
        FROM symbols_fts fts
        JOIN symbols s ON fts.rowid = s.id
        JOIN files f ON s.file_id = f.id
        WHERE symbols_fts MATCH ?
        ${options.fileTypes?.length ? `AND f.language IN (${options.fileTypes.map(t => `'${t}'`).join(',')})` : ''}
        ORDER BY bm25(symbols_fts)
        LIMIT 20
      `;

      symbols = database.prepare(symbolQuery).all(escapedQuery) as SymbolQueryRow[];
    } else {
      // Fall back to LIKE queries for special characters
      const fileQuery = `
        SELECT 
          f.id, 
          f.path, 
          f.relative_path as relativePath, 
          f.content, 
          f.language, 
          f.metadata,
          f.size,
          f.last_modified as lastModified
        FROM files f
        WHERE f.content LIKE ?
        ${options.fileTypes?.length ? `AND f.language IN (${options.fileTypes.map(t => `'${t}'`).join(',')})` : ''}
        ORDER BY f.relative_path
        LIMIT 10
      `;

      files = database.prepare(fileQuery).all(`%${query}%`) as FileQueryRow[];

      // Search symbols using LIKE
      const symbolQuery = `
        SELECT 
          s.id,
          s.name,
          s.type,
          s.line_start as lineStart,
          s.line_end as lineEnd,
          s.signature,
          f.relative_path as filePath,
          f.content as fileContent
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE (s.name LIKE ? OR s.signature LIKE ? OR s.metadata LIKE ?)
        ${options.fileTypes?.length ? `AND f.language IN (${options.fileTypes.map(t => `'${t}'`).join(',')})` : ''}
        ORDER BY LENGTH(s.name)
        LIMIT 20
      `;

      symbols = database.prepare(symbolQuery).all(`%${query}%`, `%${query}%`, `%${query}%`) as SymbolQueryRow[];
    }

    // Process results
    for (const file of files) {
      const fileResult = await this.processFileResult(file, options);
      const fileTokens = this.estimateTokens(fileResult);

      if (result.totalTokens + fileTokens > maxTokens) {
        result.truncated = true;
        break;
      }

      result.files.push(fileResult);
      result.totalTokens += fileTokens;
    }

    for (const symbol of symbols) {
      const symbolResult = this.processSymbolResult(symbol);
      const symbolTokens = this.estimateTokens(symbolResult);

      if (result.totalTokens + symbolTokens > maxTokens) {
        result.truncated = true;
        break;
      }

      result.symbols.push(symbolResult);
      result.totalTokens += symbolTokens;
    }

    return result;
  }

  private buildFileQuery(_searchTerm: string, options: QueryOptions): string {
    let query = `
      SELECT 
        f.id, 
        f.path, 
        f.relative_path as relativePath, 
        f.content, 
        f.language, 
        f.metadata,
        f.size,
        f.last_modified as lastModified
      FROM files_fts fts
      JOIN files f ON fts.rowid = f.id
      WHERE files_fts MATCH :searchTerm
    `;

    if (options.fileTypes?.length) {
      query += ` AND f.language IN (${options.fileTypes.map(t => `'${t}'`).join(',')})`;
    }

    switch (options.sortBy) {
      case 'path':
        query += ' ORDER BY f.relative_path';
        break;
      case 'size':
        query += ' ORDER BY f.size DESC';
        break;
      case 'modified':
        query += ' ORDER BY f.last_modified DESC';
        break;
      default:
        query += ' ORDER BY bm25(files_fts)';
    }

    query += ' LIMIT 10';
    return query;
  }

  private buildSymbolQuery(_searchTerm: string, options: QueryOptions): string {
    let query = `
      SELECT 
        s.id,
        s.name,
        s.type,
        s.line_start as lineStart,
        s.line_end as lineEnd,
        s.signature,
        f.relative_path as filePath,
        f.content as fileContent
      FROM symbols_fts fts
      JOIN symbols s ON fts.rowid = s.id
      JOIN files f ON s.file_id = f.id
      WHERE symbols_fts MATCH :searchTerm
    `;

    if (options.fileTypes?.length) {
      query += ` AND f.language IN (${options.fileTypes.map(t => `'${t}'`).join(',')})`;
    }

    query += ' ORDER BY bm25(symbols_fts) LIMIT 15';
    return query;
  }

  private async processFileResult(file: FileQueryRow, options: QueryOptions): Promise<FileResult> {
    const metadata = file.metadata ? JSON.parse(file.metadata) : {};
    const result: FileResult = {
      id: file.id,
      path: file.path,
      relativePath: file.relativePath || file.relative_path,
      language: file.language,
      tokens: metadata.tokens || 0
    };

    if (options.includeContent) {
      // Smart content extraction: prioritize relevant sections
      result.content = this.extractRelevantContent(file.content, options);
    } else {
      // Include a preview (first 10 lines)
      const lines = file.content.split('\n').slice(0, 10);
      result.preview = lines.join('\n');
    }

    if (options.includeImports) {
      result.imports = metadata.imports || [];
      result.exports = metadata.exports || [];
    }

    if (options.includeSymbols) {
      const database = this.db.getDatabase();
      const symbols = database.prepare(`
        SELECT id, name, type, line_start as lineStart, line_end as lineEnd, signature
        FROM symbols
        WHERE file_id = ?
        ORDER BY line_start
      `).all(file.id) as SymbolWithFileContent[];

      result.symbols = symbols.map(s => ({
        id: s.id,
        name: s.name,
        type: s.type,
        filePath: file.relativePath || file.relative_path,
        lineStart: s.line_start,
        lineEnd: s.line_end,
        signature: s.signature === null ? undefined : s.signature
      }));
    }

    return result;
  }

  private processSymbolResult(symbol: SymbolQueryRow): SymbolResult {
    const result: SymbolResult = {
      id: symbol.id,
      name: symbol.name,
      type: symbol.type,
      filePath: symbol.filePath || '',
      lineStart: symbol.lineStart || symbol.line_start,
      lineEnd: symbol.lineEnd || symbol.line_end,
      signature: symbol.signature || undefined
    };

    // Extract symbol content if fileContent is available
    if (symbol.fileContent) {
      const lines = symbol.fileContent.split('\n');
      const startLine = (symbol.lineStart || symbol.line_start) - 1;
      const endLine = (symbol.lineEnd || symbol.line_end);
      
      if (startLine >= 0 && endLine <= lines.length) {
        result.content = lines.slice(startLine, endLine).join('\n');
      }
    }

    return result;
  }

  private estimateTokens(data: unknown): number {
    // Quick estimation without encoding for performance
    // Only do actual encoding if absolutely necessary
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    
    // Use fast approximation: ~4 characters per token for English text
    // This is accurate enough for limiting purposes
    return Math.ceil(text.length / 4);
  }
  
  private accurateTokenCount(data: unknown): number {
    // Use this only when exact count is needed
    const text = JSON.stringify(data);
    try {
      return this.tokenEncoder.encode(text).length;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }
  
  private extractRelevantContent(content: string, _options: QueryOptions): string {
    const lines = content.split('\n');
    const maxLines = 200; // Reasonable limit for context
    
    // If content is small enough, return it all
    if (lines.length <= maxLines) {
      return content;
    }
    
    // For larger files, extract most relevant sections
    const relevantSections: string[] = [];
    let currentSection: string[] = [];
    let inRelevantSection = false;
    let linesIncluded = 0;
    
    // Priority patterns to identify important sections
    const importantPatterns = [
      /^(export|import|class|interface|function|const|let|var|type|enum)/,
      /^(def|class|import|from)/,  // Python
      /^(func|type|struct|interface|package)/,  // Go
      /^(public|private|protected|class|interface)/,  // Java
    ];
    
    for (let i = 0; i < lines.length && linesIncluded < maxLines; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Check if this line starts an important section
      const isImportant = importantPatterns.some(pattern => pattern.test(trimmed));
      
      if (isImportant && !inRelevantSection) {
        // Start a new relevant section
        inRelevantSection = true;
        currentSection = [line];
        linesIncluded++;
      } else if (inRelevantSection) {
        currentSection.push(line);
        linesIncluded++;
        
        // End section on empty line or after reasonable size
        if ((trimmed === '' && currentSection.length > 5) || currentSection.length > 30) {
          relevantSections.push(currentSection.join('\n'));
          currentSection = [];
          inRelevantSection = false;
        }
      }
    }
    
    // Add any remaining section
    if (currentSection.length > 0) {
      relevantSections.push(currentSection.join('\n'));
    }
    
    // If we didn't find enough relevant sections, add file beginning
    if (relevantSections.length === 0 || linesIncluded < 50) {
      relevantSections.unshift(lines.slice(0, Math.min(50, maxLines - linesIncluded)).join('\n'));
    }
    
    return relevantSections.join('\n\n// ...\n\n');
  }
  
  private prioritizeResults(files: FileQueryRow[], searchTerm: string): FileQueryRow[] {
    return files.sort((a, b) => {
      // Prioritize exact matches in path
      const aPathMatch = a.relativePath?.toLowerCase().includes(searchTerm.toLowerCase()) ? 1 : 0;
      const bPathMatch = b.relativePath?.toLowerCase().includes(searchTerm.toLowerCase()) ? 1 : 0;
      if (aPathMatch !== bPathMatch) return bPathMatch - aPathMatch;
      
      // Then prioritize by relevance (more occurrences of search term)
      const aOccurrences = (a.content.match(new RegExp(searchTerm, 'gi')) || []).length;
      const bOccurrences = (b.content.match(new RegExp(searchTerm, 'gi')) || []).length;
      if (aOccurrences !== bOccurrences) return bOccurrences - aOccurrences;
      
      // Finally, prefer smaller files (more focused)
      return (a.size || 0) - (b.size || 0);
    });
  }
  
  private prioritizeSymbolResults(symbols: SymbolQueryRow[], searchTerm: string): SymbolQueryRow[] {
    return symbols.sort((a, b) => {
      // Prioritize exact name matches
      const aExact = a.name.toLowerCase() === searchTerm.toLowerCase() ? 1 : 0;
      const bExact = b.name.toLowerCase() === searchTerm.toLowerCase() ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      
      // Then prioritize starts-with matches
      const aStartsWith = a.name.toLowerCase().startsWith(searchTerm.toLowerCase()) ? 1 : 0;
      const bStartsWith = b.name.toLowerCase().startsWith(searchTerm.toLowerCase()) ? 1 : 0;
      if (aStartsWith !== bStartsWith) return bStartsWith - aStartsWith;
      
      // Prefer certain symbol types (interfaces, classes, functions over others)
      const typeOrder: Record<string, number> = {
        'interface': 5,
        'class': 4,
        'function': 3,
        'type': 2,
        'method': 1,
        'variable': 0
      };
      const aTypeScore = typeOrder[a.type] || 0;
      const bTypeScore = typeOrder[b.type] || 0;
      if (aTypeScore !== bTypeScore) return bTypeScore - aTypeScore;
      
      // Finally, sort by name length (shorter = more likely to be what user wants)
      return a.name.length - b.name.length;
    });
  }

  public async getDependencyGraphWithDepth(symbolName: string, depth: number = 1): Promise<DependencyGraph | null> {
    // For now, depth is used to control how deep we traverse the call graph
    // Future enhancement: use depth to expand the graph to include more levels
    const graph = await this.getDependencyGraph(symbolName);
    if (graph && depth > 1) {
      // Could expand the graph here to include more levels of dependencies
      // This would involve recursively fetching dependencies of dependencies
      // Note: Depth parameter currently only shows direct dependencies
    }
    return graph;
  }
  
  public async getDependencyGraph(symbolName: string): Promise<DependencyGraph | null> {
    const database = this.db.getDatabase();
    
    // Check cache first
    const cacheKey = `dep_graph_${symbolName}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached as DependencyGraph;
    }
    
    // First, find the symbol
    const symbol = database.prepare(`
      SELECT 
        s.id as symbolId,
        s.name,
        s.type,
        s.line_start as line,
        s.file_id as fileId,
        f.relative_path as filePath
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE LOWER(s.name) = LOWER(?)
      LIMIT 1
    `).get(symbolName) as SymbolLookupResult | undefined;
    
    if (!symbol) {
      return null;
    }
    
    const root: CallGraphNode = {
      symbolId: symbol.symbolId,
      fileId: symbol.fileId,
      name: symbol.name,
      type: symbol.type,
      filePath: symbol.filePath,
      line: symbol.line
    };
    
    // Get what this symbol calls (outgoing edges)
    const callsQuery = database.prepare(`
      SELECT 
        cg.callee_name as calleeName,
        cg.call_type as callType,
        cg.line_number as callLine,
        cg.callee_symbol_id as calleeSymbolId,
        cg.callee_file_id as calleeFileId,
        s2.name as calleeRealName,
        s2.type as calleeType,
        s2.line_start as calleeLine,
        f2.relative_path as calleeFilePath
      FROM call_graph cg
      LEFT JOIN symbols s2 ON cg.callee_symbol_id = s2.id
      LEFT JOIN files f2 ON COALESCE(cg.callee_file_id, s2.file_id) = f2.id
      WHERE cg.caller_symbol_id = ?
      ORDER BY cg.line_number
    `).all(symbol.symbolId) as CallGraphResult[];
    
    const calls: CallGraphEdge[] = callsQuery.map(call => ({
      from: root,
      to: {
        symbolId: call.calleeSymbolId === null ? undefined : call.calleeSymbolId,
        fileId: call.calleeFileId || 0,
        name: call.calleeName,
        type: call.calleeType || call.callType,
        filePath: call.calleeFilePath || 'external',
        line: call.calleeLine || 0
      },
      callType: call.callType,
      line: call.callLine
    }));
    
    // Get what calls this symbol (incoming edges)
    const calledByQuery = database.prepare(`
      SELECT 
        cg.caller_symbol_id as callerSymbolId,
        cg.caller_file_id as callerFileId,
        cg.call_type as callType,
        cg.line_number as callLine,
        s1.name as callerName,
        s1.type as callerType,
        s1.line_start as callerLine,
        f1.relative_path as callerFilePath
      FROM call_graph cg
      LEFT JOIN symbols s1 ON cg.caller_symbol_id = s1.id
      LEFT JOIN files f1 ON cg.caller_file_id = f1.id
      WHERE cg.callee_name = ? OR cg.callee_symbol_id = ?
      ORDER BY f1.relative_path, cg.line_number
    `).all(symbolName, symbol.symbolId) as CallerResult[];
    
    const calledBy: CallGraphEdge[] = calledByQuery.map(caller => ({
      from: {
        symbolId: caller.callerSymbolId === null ? undefined : caller.callerSymbolId,
        fileId: caller.callerFileId,
        name: caller.callerName || 'anonymous',
        type: caller.callerType || 'unknown',
        filePath: caller.callerFilePath || 'unknown',
        line: caller.callerLine || caller.callLine
      },
      to: root,
      callType: caller.callType,
      line: caller.callLine
    }));
    
    const result = {
      root,
      calls,
      calledBy
    };
    
    // Cache the result for 5 minutes
    this.saveToCache(cacheKey, result, 5);
    
    return result;
  }

  public async getCallGraph(symbolName: string, depth: number = 1): Promise<Map<string, Set<string>>> {
    const database = this.db.getDatabase();
    const graph = new Map<string, Set<string>>();
    const visited = new Set<string>();
    
    const explore = (name: string, currentDepth: number) => {
      if (currentDepth > depth || visited.has(name)) {
        return;
      }
      visited.add(name);
      
      // Get all calls from this symbol
      const calls = database.prepare(`
        SELECT DISTINCT cg.callee_name
        FROM call_graph cg
        JOIN symbols s ON cg.caller_symbol_id = s.id
        WHERE LOWER(s.name) = LOWER(?)
      `).all(name) as { callee_name: string }[];
      
      if (calls.length > 0) {
        if (!graph.has(name)) {
          graph.set(name, new Set());
        }
        calls.forEach(call => {
          graph.get(name)!.add(call.callee_name);
          if (currentDepth < depth) {
            explore(call.callee_name, currentDepth + 1);
          }
        });
      }
    };
    
    explore(symbolName, 0);
    return graph;
  }

  public async getImpactAnalysis(symbolName: string): Promise<ImpactAnalysis | null> {
    const database = this.db.getDatabase();
    
    // Check cache first
    const cacheKey = `impact_${symbolName}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached as ImpactAnalysis;
    }
    
    // First, find the symbol
    const symbol = database.prepare(`
      SELECT 
        s.id as symbolId,
        s.name,
        s.type,
        s.line_start as line,
        s.file_id as fileId,
        f.relative_path as filePath
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE LOWER(s.name) = LOWER(?)
      LIMIT 1
    `).get(symbolName) as SymbolLookupResult | undefined;
    
    if (!symbol) {
      // Try to find references even if symbol isn't in database
      const references = this.findAllReferences(symbolName);
      if (references.length === 0) {
        return null;
      }
      // Create a minimal impact analysis for non-indexed symbols
      return this.createImpactAnalysisFromReferences(symbolName, references);
    }
    
    // Get all references to this symbol
    const directReferences = database.prepare(`
      SELECT 
        cg.caller_symbol_id as callerSymbolId,
        cg.caller_file_id as callerFileId,
        s.name as callerName,
        s.type as callerType,
        f.relative_path as callerFilePath,
        s.line_start as callerLine,
        cg.call_type as callType,
        cg.line_number as callLine
      FROM call_graph cg
      JOIN files f ON cg.caller_file_id = f.id
      LEFT JOIN symbols s ON cg.caller_symbol_id = s.id
      WHERE cg.callee_name = ? OR cg.callee_symbol_id = ?
      ORDER BY f.relative_path, cg.line_number
    `).all(symbolName, symbol.symbolId) as CallerResult[];
    
    // Get text-based references (catches things AST might miss)
    const textReferences = database.prepare(`
      SELECT 
        f.id as fileId,
        f.relative_path as filePath,
        f.content,
        f.language
      FROM files f
      WHERE f.content LIKE '%' || ? || '%'
        AND f.id != ?
    `).all(symbolName, symbol.fileId) as Array<{
      fileId: number;
      filePath: string;
      content: string;
      language: string | null;
    }>;
    
    // Analyze each file for actual references
    const affectedFiles = new Map<string, {
      path: string;
      referenceCount: number;
      isTest: boolean;
      lines: number[];
    }>();
    
    // Process direct call graph references
    directReferences.forEach(ref => {
      const key = ref.callerFilePath;
      if (!affectedFiles.has(key)) {
        affectedFiles.set(key, {
          path: ref.callerFilePath,
          referenceCount: 0,
          isTest: this.isTestFile(ref.callerFilePath),
          lines: []
        });
      }
      const file = affectedFiles.get(key)!;
      file.referenceCount++;
      file.lines.push(ref.callLine);
    });
    
    // Process text references to find additional occurrences
    textReferences.forEach(file => {
      const lines = file.content.split('\n');
      const matches: number[] = [];
      
      lines.forEach((line: string, index: number) => {
        if (line.includes(symbolName)) {
          matches.push(index + 1);
        }
      });
      
      if (matches.length > 0) {
        const key = file.filePath || '';
        if (!affectedFiles.has(key)) {
          affectedFiles.set(key, {
            path: file.filePath || '',
            referenceCount: matches.length,
            isTest: this.isTestFile(file.filePath || ''),
            lines: matches
          });
        } else {
          // Merge with existing data
          const existing = affectedFiles.get(key)!;
          existing.lines = [...new Set([...existing.lines, ...matches])].sort((a, b) => a - b);
          existing.referenceCount = existing.lines.length;
        }
      }
    });
    
    // Calculate impact metrics
    const affectedFilesList = Array.from(affectedFiles.values());
    const testFiles = affectedFilesList.filter(f => f.isTest);
    // const implementationFiles = affectedFilesList.filter(f => !f.isTest);
    
    // Count total references
    const totalReferences = affectedFilesList.reduce((sum, f) => sum + f.referenceCount, 0);
    
    // Get unique symbols that reference this one
    const affectedSymbols = new Set(directReferences.map(r => r.callerName).filter(Boolean));
    
    // Categorize files
    const impactByType = {
      implementation: 0,
      tests: 0,
      configs: 0,
      other: 0
    };
    
    affectedFilesList.forEach(file => {
      if (file.isTest) {
        impactByType.tests++;
      } else if (file.path.includes('config') || file.path.endsWith('.json')) {
        impactByType.configs++;
      } else if (file.path.endsWith('.ts') || file.path.endsWith('.js') || 
                 file.path.endsWith('.py') || file.path.endsWith('.java')) {
        impactByType.implementation++;
      } else {
        impactByType.other++;
      }
    });
    
    // Calculate risk level
    const riskFactors: string[] = [];
    let riskScore = 0;
    
    if (totalReferences > 50) {
      riskFactors.push(`High reference count (${totalReferences})`);
      riskScore += 3;
    } else if (totalReferences > 20) {
      riskFactors.push(`Moderate reference count (${totalReferences})`);
      riskScore += 2;
    } else if (totalReferences > 5) {
      riskFactors.push(`Some references (${totalReferences})`);
      riskScore += 1;
    }
    
    if (affectedFilesList.length > 10) {
      riskFactors.push(`Many files affected (${affectedFilesList.length})`);
      riskScore += 2;
    } else if (affectedFilesList.length > 5) {
      riskFactors.push(`Several files affected (${affectedFilesList.length})`);
      riskScore += 1;
    }
    
    if (testFiles.length === 0 && totalReferences > 0) {
      riskFactors.push('No test coverage detected');
      riskScore += 2;
    }
    
    if (symbol.type === 'interface' || symbol.type === 'type') {
      riskFactors.push('Type/Interface changes affect compile-time');
      riskScore += 1;
    }
    
    if (symbol.name.toLowerCase().includes('api') || symbol.name.toLowerCase().includes('public')) {
      riskFactors.push('Appears to be a public API');
      riskScore += 2;
    }
    
    // Determine risk level
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    if (riskScore >= 7) {
      riskLevel = 'CRITICAL';
    } else if (riskScore >= 5) {
      riskLevel = 'HIGH';
    } else if (riskScore >= 3) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'LOW';
    }
    
    // Generate suggestions
    const suggestions: string[] = [];
    
    if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
      suggestions.push('Consider creating a compatibility layer before making breaking changes');
      suggestions.push('Document the migration path for consumers');
    }
    
    if (testFiles.length === 0 && totalReferences > 0) {
      suggestions.push('Add tests before modifying this symbol');
    }
    
    if (totalReferences > 20) {
      suggestions.push('Consider refactoring in stages to minimize risk');
      suggestions.push('Use deprecation warnings before removal');
    }
    
    if (symbol.type === 'interface' || symbol.type === 'type') {
      suggestions.push('Type changes will require recompilation of dependent code');
    }
    
    const impact: ImpactAnalysis = {
      symbol: symbol.name,
      type: symbol.type,
      location: `${symbol.filePath}:${symbol.line}`,
      
      directReferences: totalReferences,
      filesAffected: affectedFilesList.length,
      symbolsAffected: affectedSymbols.size,
      
      testsAffected: testFiles.length,
      testFiles: testFiles.map(f => f.path),
      
      impactByType,
      
      riskLevel,
      riskFactors,
      
      affectedFiles: affectedFilesList
        .sort((a, b) => b.referenceCount - a.referenceCount)
        .slice(0, 20), // Limit to top 20 files
      
      suggestions
    };
    
    // Cache the result for 10 minutes
    this.saveToCache(cacheKey, impact, 10);
    
    return impact;
  }
  
  private isTestFile(filePath: string): boolean {
    const testPatterns = [
      '.test.', '.spec.', '_test.', '_spec.',
      '/test/', '/tests/', '/spec/', '/specs/',
      '/__tests__/', '/__test__/'
    ];
    
    const lowerPath = filePath.toLowerCase();
    return testPatterns.some(pattern => lowerPath.includes(pattern));
  }
  
  private findAllReferences(symbolName: string): FileReferenceRow[] {
    const database = this.db.getDatabase();
    
    // Find all files that mention this symbol
    return database.prepare(`
      SELECT 
        f.id as fileId,
        f.relative_path as filePath,
        f.content,
        f.language
      FROM files f
      WHERE f.content LIKE '%' || ? || '%'
    `).all(symbolName) as FileReferenceRow[];
  }
  
  private createImpactAnalysisFromReferences(symbolName: string, references: FileReferenceRow[]): ImpactAnalysis {
    const affectedFiles: ImpactAnalysis['affectedFiles'] = [];
    
    references.forEach(file => {
      const lines = file.content.split('\n');
      const matches: number[] = [];
      
      lines.forEach((line: string, index: number) => {
        if (line.includes(symbolName)) {
          matches.push(index + 1);
        }
      });
      
      if (matches.length > 0) {
        affectedFiles.push({
          path: file.filePath || file.path || '',
          referenceCount: matches.length,
          isTest: this.isTestFile(file.filePath || file.path || ''),
          lines: matches
        });
      }
    });
    
    const testFiles = affectedFiles.filter(f => f.isTest);
    const totalReferences = affectedFiles.reduce((sum, f) => sum + f.referenceCount, 0);
    
    return {
      symbol: symbolName,
      type: 'unknown',
      location: 'not indexed',
      
      directReferences: totalReferences,
      filesAffected: affectedFiles.length,
      symbolsAffected: 0,
      
      testsAffected: testFiles.length,
      testFiles: testFiles.map(f => f.path),
      
      impactByType: {
        implementation: affectedFiles.filter(f => !f.isTest).length,
        tests: testFiles.length,
        configs: 0,
        other: 0
      },
      
      riskLevel: totalReferences > 10 ? 'HIGH' : totalReferences > 5 ? 'MEDIUM' : 'LOW',
      riskFactors: [`Symbol not indexed but found ${totalReferences} text references`],
      
      affectedFiles: affectedFiles.sort((a, b) => b.referenceCount - a.referenceCount),
      
      suggestions: ['Consider indexing this symbol for better analysis']
    };
  }

  public async getGitHistory(symbolName: string): Promise<GitHistory | null> {
    const database = this.db.getDatabase();
    
    // Find the symbol to get its file and location
    const symbol = database.prepare(`
      SELECT 
        s.name,
        s.line_start as lineStart,
        s.line_end as lineEnd,
        f.relative_path as filePath
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE LOWER(s.name) = LOWER(?)
      LIMIT 1
    `).get(symbolName) as SymbolLookupResult | undefined;
    
    if (!symbol) {
      // Try to find the file that contains this text
      const fileResult = database.prepare(`
        SELECT relative_path as filePath
        FROM files
        WHERE content LIKE '%' || ? || '%'
        LIMIT 1
      `).get(symbolName) as FilePathResult | undefined;
      
      if (fileResult) {
        return this.gitAnalyzer.getGitHistory(fileResult.filePath, symbolName);
      }
      return null;
    }
    
    return this.gitAnalyzer.getGitHistory(
      symbol.filePath,
      symbol.name,
      symbol.lineStart,
      symbol.lineEnd
    );
  }
  
  public async getRecentChanges(days: number = 7): Promise<RecentFileChanges[]> {
    return this.gitAnalyzer.getRecentChanges(days);
  }
  
  public async getFuzzySuggestions(searchTerm: string, limit: number = 5): Promise<string[]> {
    const database = this.db.getDatabase();
    
    // Get suggestions from symbols using Levenshtein-like fuzzy matching
    const suggestions = database.prepare(`
      SELECT DISTINCT name
      FROM symbols
      WHERE LOWER(name) LIKE LOWER(?)
         OR LOWER(name) LIKE LOWER(?)
         OR LOWER(name) LIKE LOWER(?)
      ORDER BY 
        CASE 
          WHEN LOWER(name) = LOWER(?) THEN 0
          WHEN LOWER(name) LIKE LOWER(?) THEN 1
          WHEN LOWER(name) LIKE LOWER(?) THEN 2
          ELSE 3
        END,
        LENGTH(name) - LENGTH(?) ASC
      LIMIT ?
    `).all(
      `%${searchTerm}%`,  // Contains
      `${searchTerm}%`,   // Starts with
      `%${searchTerm}`,   // Ends with
      searchTerm,         // Exact match
      `${searchTerm}%`,   // Starts with (for ordering)
      `%${searchTerm}%`,  // Contains (for ordering)
      searchTerm,         // For length difference calculation
      limit
    ) as { name: string }[];
    
    return suggestions.map(s => s.name);
  }

  public async listAllSymbols(options: {
    fileTypes?: string[];
    symbolType?: string;
    limit?: number;
  } = {}): Promise<SymbolResult[]> {
    const database = this.db.getDatabase();
    const limit = options.limit || 100;
    
    let whereConditions: string[] = [];
    const params: any[] = [];
    
    if (options.fileTypes?.length) {
      const placeholders = options.fileTypes.map(() => '?').join(',');
      whereConditions.push(`f.language IN (${placeholders})`);
      params.push(...options.fileTypes);
    }
    
    if (options.symbolType) {
      whereConditions.push(`s.type = ?`);
      params.push(options.symbolType);
    }
    
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';
    
    const query = `
      SELECT 
        s.id,
        s.name,
        s.type,
        s.signature,
        s.file_id,
        s.line_start as lineStart,
        s.line_end as lineEnd,
        f.relative_path as filePath
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      ${whereClause}
      ORDER BY s.type, s.name
      LIMIT ?
    `;
    
    params.push(limit);
    const results = database.prepare(query).all(...params) as SymbolQueryRow[];
    
    return results.map(symbol => this.processSymbolResult(symbol));
  }

  public async listAllFiles(options: {
    fileTypes?: string[];
    limit?: number;
  } = {}): Promise<FileResult[]> {
    const database = this.db.getDatabase();
    const limit = options.limit || 100;
    
    let whereConditions: string[] = [];
    const params: any[] = [];
    
    if (options.fileTypes?.length) {
      const placeholders = options.fileTypes.map(() => '?').join(',');
      whereConditions.push(`language IN (${placeholders})`);
      params.push(...options.fileTypes);
    }
    
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';
    
    const query = `
      SELECT 
        id,
        relative_path,
        language,
        size,
        hash,
        last_modified,
        LENGTH(content) / 4 as tokens  -- Approximate token count
      FROM files
      ${whereClause}
      ORDER BY relative_path
      LIMIT ?
    `;
    
    params.push(limit);
    const files = database.prepare(query).all(...params) as FileQueryRow[];
    
    return files.map(file => ({
      id: file.id,
      path: file.relative_path,  // FileResult expects 'path' property
      relativePath: file.relative_path,
      language: file.language,
      tokens: file.tokens || 0,
      hash: file.hash,
      lastModified: new Date(file.last_modified),
      content: ''  // Don't include content in list view
    }));
  }

  public async getContextSummary(): Promise<string> {
    const stats = await this.db.getDatabaseInfo();
    const database = this.db.getDatabase();

    const languages = database.prepare(`
      SELECT language, COUNT(*) as count
      FROM files
      WHERE language IS NOT NULL
      GROUP BY language
      ORDER BY count DESC
      LIMIT 5
    `).all() as { language: string; count: number }[];

    const topSymbols = database.prepare(`
      SELECT type, COUNT(*) as count
      FROM symbols
      GROUP BY type
      ORDER BY count DESC
      LIMIT 5
    `).all() as { type: string; count: number }[];

    let summary = `📊 Project Context Summary\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `📁 Files indexed: ${stats.fileCount}\n`;
    summary += `🔤 Symbols extracted: ${stats.symbolCount}\n\n`;

    if (languages.length > 0) {
      summary += `🗣️ Languages:\n`;
      languages.forEach(lang => {
        summary += `  • ${lang.language}: ${lang.count} files\n`;
      });
      summary += '\n';
    }

    if (topSymbols.length > 0) {
      summary += `🏷️ Symbol Types:\n`;
      topSymbols.forEach(symbol => {
        summary += `  • ${symbol.type}: ${symbol.count}\n`;
      });
    }

    return summary;
  }
  
  private getFromCache(key: string): unknown | null {
    const database = this.db.getDatabase();
    const cached = database.prepare(`
      SELECT result FROM context_cache 
      WHERE query_hash = ? AND expires_at > datetime('now')
    `).get(key) as { result: string } | undefined;
    
    if (cached) {
      try {
        return JSON.parse(cached.result);
      } catch {
        // Invalid cache entry, ignore
      }
    }
    return null;
  }
  
  private saveToCache(key: string, data: unknown, expirationMinutes: number = 15): void {
    const database = this.db.getDatabase();
    const result = JSON.stringify(data);
    
    // Delete existing cache entry if exists
    database.prepare('DELETE FROM context_cache WHERE query_hash = ?').run(key);
    
    // Insert new cache entry
    database.prepare(`
      INSERT INTO context_cache (query_hash, result, expires_at)
      VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))
    `).run(key, result, expirationMinutes);
  }
  
  private escapeFTS5(term: string): string {
    // FTS5 special characters that need escaping or removal
    // For special patterns like decorators (@router.post) or function calls (Depends())
    // we'll return empty to trigger LIKE fallback which handles them better
    
    // Check if this is a decorator pattern (starts with @)
    if (term.startsWith('@')) {
      return ''; // Use LIKE for decorator searches
    }
    
    // Check if this contains parentheses (function call pattern)
    if (term.includes('(') || term.includes(')')) {
      return ''; // Use LIKE for function call patterns
    }
    
    // Check if this is an expanded alias with OR operators
    if (term.includes(' OR ')) {
      // For expanded aliases, we need to use LIKE since FTS5 OR syntax is complex
      return ''; // Fall back to LIKE for OR queries
    }
    
    // Check for dots which might indicate method calls or module paths
    // FTS5 doesn't handle dots well, so use LIKE for these patterns
    if (term.includes('.')) {
      return ''; // Use LIKE for patterns with dots (e.g., router.post, app.get)
    }
    
    // Remove special characters
    const cleaned = term.replace(/[^a-zA-Z0-9\s_-]/g, '');
    
    // If nothing remains after cleaning, we can't use FTS5
    if (cleaned.trim().length === 0) {
      return '';
    }
    
    // Split into multiple terms and handle each one
    const terms = cleaned.trim().split(/\s+/).filter(t => t.length > 0);
    
    // For multi-term search, use OR to find any term (more inclusive)
    // This helps with queries like "database sqlite" finding files with either term
    if (terms.length > 1) {
      return terms.join(' OR ');
    }
    
    // For single terms, use prefix matching to be more flexible
    return terms[0] + '*';
  }
  
  private async fuzzySearchSymbols(searchTerm: string, options: QueryOptions = {}): Promise<SymbolQueryRow[]> {
    const database = this.db.getDatabase();
    
    // First try a more lenient SQL search before resorting to loading all symbols
    const lowerTerm = searchTerm.toLowerCase();
    let sqlQuery = `
      SELECT 
        s.id,
        s.file_id,
        s.name,
        s.type,
        s.line_start as lineStart,
        s.line_end as lineEnd,
        s.signature,
        s.documentation,
        s.metadata,
        f.relative_path as filePath,
        f.language,
        f.content as fileContent
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE 
        LOWER(s.name) LIKE ? OR
        LOWER(s.name) LIKE ? OR
        LOWER(s.name) LIKE ?
    `;
    
    const sqlParams = [
      `%${lowerTerm}%`,  // Contains
      `${lowerTerm}%`,   // Starts with
      `%${lowerTerm}`    // Ends with
    ];
    
    if (options.fileTypes && options.fileTypes.length > 0) {
      sqlQuery += ` AND f.language IN (${options.fileTypes.map(() => '?').join(',')})`;
      sqlParams.push(...options.fileTypes);
    }
    
    sqlQuery += ` ORDER BY 
      CASE 
        WHEN LOWER(s.name) = ? THEN 0
        WHEN LOWER(s.name) LIKE ? THEN 1
        WHEN LOWER(s.name) LIKE ? THEN 2
        ELSE 3
      END,
      LENGTH(s.name)
      LIMIT 50`;
    
    sqlParams.push(lowerTerm, `${lowerTerm}%`, `%${lowerTerm}%`);
    
    let candidates = database.prepare(sqlQuery).all(...sqlParams) as SymbolQueryRow[];
    
    // If we still have few results, try fuzzy matching on a larger set
    if (candidates.length < 5) {
      // Get more symbols for fuzzy matching
      let query = `
        SELECT 
          s.id,
          s.file_id,
          s.name,
          s.type,
          s.line_start as lineStart,
          s.line_end as lineEnd,
          s.signature,
          s.documentation,
          s.metadata,
          f.relative_path as filePath,
          f.language,
          f.content as fileContent
        FROM symbols s
        JOIN files f ON s.file_id = f.id
      `;
      
      if (options.fileTypes && options.fileTypes.length > 0) {
        query += ` WHERE f.language IN (${options.fileTypes.map(() => '?').join(',')})`;
      }
      
      query += ` LIMIT 1000`; // Limit to avoid loading entire database
      
      const moreSymbols = database.prepare(query).all(...(options.fileTypes || [])) as SymbolQueryRow[];
      
      // Configure Fuse for fuzzy matching with better tolerance
      const fuse = new Fuse(moreSymbols, {
        keys: [
          { name: 'name', weight: 0.7 },
          { name: 'signature', weight: 0.3 }
        ],
        threshold: 0.5, // More tolerant for typos
        includeScore: true,
        ignoreLocation: true,
        minMatchCharLength: Math.max(2, searchTerm.length - 2),
        shouldSort: true
      });
      
      // Search and merge results
      const fuzzyResults = fuse.search(searchTerm);
      const existingIds = new Set(candidates.map(c => c.id));
      
      for (const result of fuzzyResults) {
        if (!existingIds.has(result.item.id)) {
          candidates.push(result.item);
          if (candidates.length >= 10) break;
        }
      }
    }
    
    return candidates.slice(0, 10);
  }
  
  private buildFileLikeQuery(searchTerm: string, options: QueryOptions): string {
    // Check if this is an OR query (expanded alias)
    const isOrQuery = searchTerm.includes(' OR ');
    let whereClause: string;
    
    if (isOrQuery) {
      // Split OR terms and build conditions for each
      const terms = searchTerm.split(/\s+OR\s+/i);
      const conditions = terms.map(() => '(f.content LIKE ? OR f.relative_path LIKE ?)').join(' OR ');
      whereClause = `WHERE (${conditions})`;
    } else {
      whereClause = 'WHERE (f.content LIKE ? OR f.relative_path LIKE ?)';
    }
    
    let query = `
      SELECT 
        f.id, f.path, f.relative_path, f.content, 
        f.language, f.metadata, f.size, f.last_modified
      FROM files f
      ${whereClause}
    `;
    
    if (options.fileTypes && options.fileTypes.length > 0) {
      query += ` AND f.language IN (${options.fileTypes.map(() => '?').join(',')})`;
    }
    
    query += ' ORDER BY f.relative_path LIMIT 100';
    return query;
  }
  
  private buildSymbolLikeQuery(searchTerm: string, options: QueryOptions): string {
    // Check if this is an OR query (expanded alias)
    const isOrQuery = searchTerm.includes(' OR ');
    let whereClause: string;
    
    if (isOrQuery) {
      // Split OR terms and build conditions for each
      const terms = searchTerm.split(/\s+OR\s+/i);
      const conditions = terms.map(() => '(s.name LIKE ? OR s.signature LIKE ? OR s.metadata LIKE ?)').join(' OR ');
      whereClause = `WHERE (${conditions})`;
    } else {
      whereClause = 'WHERE (s.name LIKE ? OR s.signature LIKE ? OR s.metadata LIKE ?)';
    }
    
    // For multi-word searches like "async def get_current_user", prioritize signature matches
    const hasMultipleWords = !isOrQuery && searchTerm.trim().split(/\s+/).length > 1;
    
    let query = `
      SELECT 
        s.*, f.relative_path as filePath, f.language, f.content as fileContent
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      ${whereClause}
    `;
    
    if (options.symbolType) {
      query += ` AND s.type = '${options.symbolType}'`;
    }
    
    if (options.fileTypes && options.fileTypes.length > 0) {
      query += ` AND f.language IN (${options.fileTypes.map(() => '?').join(',')})`;
    }
    
    // Better ordering: prioritize exact matches and signature matches for multi-word queries
    if (isOrQuery) {
      // For OR queries, just order by name length
      query += ` ORDER BY LENGTH(s.name) LIMIT 100`;
    } else if (hasMultipleWords) {
      query += ` ORDER BY 
        CASE 
          WHEN s.signature LIKE ? THEN 0
          WHEN s.name LIKE ? THEN 1
          ELSE 2
        END,
        LENGTH(s.name)
      LIMIT 100`;
    } else {
      query += ` ORDER BY 
        CASE 
          WHEN LOWER(s.name) = LOWER(?) THEN 0
          WHEN s.name LIKE ? THEN 1
          ELSE 2
        END,
        LENGTH(s.name)
      LIMIT 100`;
    }
    
    return query;
  }
  
  private looksLikeFilePath(searchTerm: string): boolean {
    // Check if the search term looks like a file path
    return searchTerm.includes('/') || 
           searchTerm.includes('\\') || 
           searchTerm.includes('.') && 
           (searchTerm.endsWith('.py') || searchTerm.endsWith('.js') || 
            searchTerm.endsWith('.ts') || searchTerm.endsWith('.tsx') ||
            searchTerm.endsWith('.jsx') || searchTerm.endsWith('.java') ||
            searchTerm.endsWith('.go') || searchTerm.endsWith('.rs') ||
            searchTerm.endsWith('.cpp') || searchTerm.endsWith('.c') ||
            searchTerm.endsWith('.h') || searchTerm.endsWith('.hpp') ||
            searchTerm.endsWith('.cs') || searchTerm.endsWith('.rb') ||
            searchTerm.endsWith('.php') || searchTerm.endsWith('.swift'));
  }
  
  private async searchByFilePath(searchTerm: string, options: QueryOptions): Promise<FileQueryRow[]> {
    const database = this.db.getDatabase();
    
    // Normalize the search term (remove leading ./ or trailing extensions sometimes)
    const normalizedPath = searchTerm.replace(/^\.[\/\\]/, '').replace(/\\/, '/');
    
    // Try exact match first
    let query = `
      SELECT 
        f.id, f.path, f.relative_path, f.content, 
        f.language, f.metadata, f.size, f.last_modified
      FROM files f
      WHERE f.relative_path = ? OR f.path = ?
    `;
    
    let files = database.prepare(query).all(normalizedPath, normalizedPath) as FileQueryRow[];
    
    // If no exact match, try partial matches
    if (files.length === 0) {
      query = `
        SELECT 
          f.id, f.path, f.relative_path, f.content, 
          f.language, f.metadata, f.size, f.last_modified
        FROM files f
        WHERE f.relative_path LIKE ? OR f.path LIKE ?
        ORDER BY 
          CASE 
            WHEN f.relative_path LIKE ? THEN 0
            WHEN f.relative_path LIKE ? THEN 1
            ELSE 2
          END,
          LENGTH(f.relative_path)
        LIMIT 20
      `;
      
      const searchPattern = `%${normalizedPath}%`;
      const endsWithPattern = `%${normalizedPath}`;
      const startsWithPattern = `${normalizedPath}%`;
      
      files = database.prepare(query).all(
        searchPattern, searchPattern,
        endsWithPattern, startsWithPattern
      ) as FileQueryRow[];
    }
    
    // Apply file type filters if specified
    if (options.fileTypes && options.fileTypes.length > 0) {
      files = files.filter(f => f.language && options.fileTypes!.includes(f.language));
    }
    
    return files;
  }
  
  private async fuzzySearchFiles(searchTerm: string, options: QueryOptions = {}): Promise<FileQueryRow[]> {
    const database = this.db.getDatabase();
    
    // Get all files for fuzzy matching
    let query = `
      SELECT 
        f.id, f.path, f.relative_path, f.content,
        f.language, f.metadata, f.size, f.last_modified
      FROM files f
    `;
    
    if (options.fileTypes && options.fileTypes.length > 0) {
      query += ` WHERE f.language IN (${options.fileTypes.map(() => '?').join(',')})`;
    }
    
    const allFiles = database.prepare(query).all(...(options.fileTypes || [])) as FileQueryRow[];
    
    // Configure Fuse for fuzzy matching on file paths
    const fuse = new Fuse(allFiles, {
      keys: ['relative_path', 'path'],
      threshold: 0.4, // Adjust for typo tolerance
      includeScore: true,
      ignoreLocation: true,
      minMatchCharLength: 2
    });
    
    // Search and return top matches
    const results = fuse.search(searchTerm);
    return results.slice(0, 10).map(r => r.item);
  }
}