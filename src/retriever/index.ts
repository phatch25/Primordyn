import { PrimordynDB } from '../database/index.js';
import { encodingForModel } from 'js-tiktoken';
import { GitAnalyzer } from '../git/analyzer.js';
import type { QueryOptions, QueryResult, FileResult, SymbolResult, DependencyGraph, CallGraphNode, CallGraphEdge, ImpactAnalysis, GitHistory } from '../types/index.js';

export class ContextRetriever {
  private db: PrimordynDB;
  private tokenEncoder: any;
  private gitAnalyzer: GitAnalyzer;

  constructor(db: PrimordynDB) {
    this.db = db;
    // Use GPT-4 encoder as it's similar to Claude's tokenization
    this.tokenEncoder = encodingForModel('gpt-4');
    this.gitAnalyzer = new GitAnalyzer();
  }

  public async query(searchTerm: string, options: QueryOptions = {}): Promise<QueryResult> {
    const maxTokens = options.maxTokens || 4000;
    const database = this.db.getDatabase();

    const result: QueryResult = {
      files: [],
      symbols: [],
      totalTokens: 0,
      truncated: false
    };

    // Use FTS for better search
    const fileQuery = this.buildFileQuery(searchTerm, options);
    const files = database.prepare(fileQuery).all({ searchTerm }) as any[];

    // Search in symbols using FTS
    const symbolQuery = this.buildSymbolQuery(searchTerm, options);
    const symbols = database.prepare(symbolQuery).all({ searchTerm }) as any[];

    // Process results with token limit
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

  public async getFileContext(filePath: string, options: QueryOptions = {}): Promise<FileResult | null> {
    const database = this.db.getDatabase();
    
    const file = database.prepare(`
      SELECT id, path, relative_path as relativePath, content, language, metadata
      FROM files
      WHERE path = ? OR relative_path = ?
    `).get(filePath, filePath) as any;

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
    `).get(filePath, filePath) as any;

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
        SELECT id, path, relative_path as relativePath, content, language, metadata
        FROM files
        WHERE relative_path LIKE ?
        LIMIT 5
      `).all(`%${importPath}%`) as any[];

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
    
    // Search for files that contain references to this symbol
    // This includes imports, function calls, class instantiations, etc.
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
    
    const files = database.prepare(query).all(...params) as any[];
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
    const database = this.db.getDatabase();

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
      ${options.fileTypes?.length ? `AND f.language IN (${options.fileTypes.map(() => '?').join(',')})` : ''}
      ORDER BY 
        bm25(symbols_fts),
        CASE WHEN s.name = ? THEN 0 ELSE 1 END,
        LENGTH(s.name)
      LIMIT 20
    `;

    const params = [symbolName, symbolName];
    if (options.fileTypes?.length) {
      params.push(...options.fileTypes);
    }

    const symbols = database.prepare(query).all(...params) as any[];

    return symbols.map(symbol => this.processSymbolResult(symbol));
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

    const files = database.prepare(fileQuery).all(query) as any[];

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

    const symbols = database.prepare(symbolQuery).all(query) as any[];

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

  private buildFileQuery(searchTerm: string, options: QueryOptions): string {
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

  private buildSymbolQuery(searchTerm: string, options: QueryOptions): string {
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

  private async processFileResult(file: any, options: QueryOptions): Promise<FileResult> {
    const metadata = file.metadata ? JSON.parse(file.metadata) : {};
    const result: FileResult = {
      id: file.id,
      path: file.path,
      relativePath: file.relativePath,
      language: file.language,
      tokens: metadata.tokens || 0
    };

    if (options.includeContent) {
      result.content = file.content;
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
      `).all(file.id) as any[];

      result.symbols = symbols.map(s => ({
        id: s.id,
        name: s.name,
        type: s.type,
        filePath: file.relativePath,
        lineStart: s.lineStart,
        lineEnd: s.lineEnd,
        signature: s.signature
      }));
    }

    return result;
  }

  private processSymbolResult(symbol: any): SymbolResult {
    const result: SymbolResult = {
      id: symbol.id,
      name: symbol.name,
      type: symbol.type,
      filePath: symbol.filePath,
      lineStart: symbol.lineStart,
      lineEnd: symbol.lineEnd,
      signature: symbol.signature
    };

    if (symbol.fileContent) {
      // Extract the symbol's content
      const lines = symbol.fileContent.split('\n');
      const symbolLines = lines.slice(symbol.lineStart - 1, symbol.lineEnd);
      result.content = symbolLines.join('\n');
    }

    return result;
  }

  private estimateTokens(data: any): number {
    const text = JSON.stringify(data);
    try {
      return this.tokenEncoder.encode(text).length;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }

  public async getDependencyGraphWithDepth(symbolName: string, depth: number = 1): Promise<DependencyGraph | null> {
    // For now, depth is used to control how deep we traverse the call graph
    // Future enhancement: use depth to expand the graph to include more levels
    const graph = await this.getDependencyGraph(symbolName);
    if (graph && depth > 1) {
      // Could expand the graph here to include more levels of dependencies
      // This would involve recursively fetching dependencies of dependencies
      console.log(`Note: Depth ${depth} requested but currently only showing direct dependencies`);
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
      WHERE s.name = ?
      LIMIT 1
    `).get(symbolName) as any;
    
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
    `).all(symbol.symbolId) as any[];
    
    const calls: CallGraphEdge[] = callsQuery.map(call => ({
      from: root,
      to: {
        symbolId: call.calleeSymbolId,
        fileId: call.calleeFileId || 0,
        name: call.calleeRealName || call.calleeName,
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
    `).all(symbolName, symbol.symbolId) as any[];
    
    const calledBy: CallGraphEdge[] = calledByQuery.map(caller => ({
      from: {
        symbolId: caller.callerSymbolId,
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
        WHERE s.name = ?
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
      WHERE s.name = ?
      LIMIT 1
    `).get(symbolName) as any;
    
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
        cg.caller_file_id as fileId,
        cg.line_number as line,
        f.relative_path as filePath,
        f.language,
        cg.call_type as callType,
        s.name as callerSymbol
      FROM call_graph cg
      JOIN files f ON cg.caller_file_id = f.id
      LEFT JOIN symbols s ON cg.caller_symbol_id = s.id
      WHERE cg.callee_name = ? OR cg.callee_symbol_id = ?
      ORDER BY f.relative_path, cg.line_number
    `).all(symbolName, symbol.symbolId) as any[];
    
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
    `).all(symbolName, symbol.fileId) as any[];
    
    // Analyze each file for actual references
    const affectedFiles = new Map<string, {
      path: string;
      referenceCount: number;
      isTest: boolean;
      lines: number[];
    }>();
    
    // Process direct call graph references
    directReferences.forEach(ref => {
      const key = ref.filePath;
      if (!affectedFiles.has(key)) {
        affectedFiles.set(key, {
          path: ref.filePath,
          referenceCount: 0,
          isTest: this.isTestFile(ref.filePath),
          lines: []
        });
      }
      const file = affectedFiles.get(key)!;
      file.referenceCount++;
      file.lines.push(ref.line);
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
        const key = file.filePath;
        if (!affectedFiles.has(key)) {
          affectedFiles.set(key, {
            path: file.filePath,
            referenceCount: matches.length,
            isTest: this.isTestFile(file.filePath),
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
    const affectedSymbols = new Set(directReferences.map(r => r.callerSymbol).filter(Boolean));
    
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
  
  private findAllReferences(symbolName: string): any[] {
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
    `).all(symbolName) as any[];
  }
  
  private createImpactAnalysisFromReferences(symbolName: string, references: any[]): ImpactAnalysis {
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
          path: file.filePath,
          referenceCount: matches.length,
          isTest: this.isTestFile(file.filePath),
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
      WHERE s.name = ?
      LIMIT 1
    `).get(symbolName) as any;
    
    if (!symbol) {
      // Try to find the file that contains this text
      const fileResult = database.prepare(`
        SELECT relative_path as filePath
        FROM files
        WHERE content LIKE '%' || ? || '%'
        LIMIT 1
      `).get(symbolName) as any;
      
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
  
  public async getRecentChanges(days: number = 7): Promise<{ file: string; commits: any[] }[]> {
    return this.gitAnalyzer.getRecentChanges(days);
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
}