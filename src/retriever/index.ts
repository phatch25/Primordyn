import { PrimordynDB } from '../database/index.js';
import { encodingForModel } from 'js-tiktoken';
import type { QueryOptions, QueryResult, FileResult, SymbolResult } from '../types/index.js';

export class ContextRetriever {
  private db: PrimordynDB;
  private tokenEncoder: any;

  constructor(db: PrimordynDB) {
    this.db = db;
    // Use GPT-4 encoder as it's similar to Claude's tokenization
    this.tokenEncoder = encodingForModel('gpt-4');
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
}