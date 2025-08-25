import Database from 'better-sqlite3';
import type { QueryOptions, FileQueryRow, SymbolQueryRow } from '../types/index.js';

export interface SearchStrategy {
  searchFiles(searchTerm: string, options: QueryOptions): FileQueryRow[];
  searchSymbols(searchTerm: string, options: QueryOptions): SymbolQueryRow[];
}

export class FTSSearchStrategy implements SearchStrategy {
  constructor(private db: Database.Database) {}

  searchFiles(searchTerm: string, options: QueryOptions): FileQueryRow[] {
    const query = this.buildFileQuery(searchTerm, options);
    return this.db.prepare(query).all({ searchTerm }) as FileQueryRow[];
  }

  searchSymbols(searchTerm: string, options: QueryOptions): SymbolQueryRow[] {
    const query = this.buildSymbolQuery(searchTerm, options);
    return this.db.prepare(query).all({ searchTerm }) as SymbolQueryRow[];
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
}

export class LikeSearchStrategy implements SearchStrategy {
  constructor(private db: Database.Database) {}

  searchFiles(searchTerm: string, options: QueryOptions): FileQueryRow[] {
    const query = this.buildFileLikeQuery(searchTerm, options);
    const params = this.buildFileParams(searchTerm, options);
    return this.db.prepare(query).all(...params) as FileQueryRow[];
  }

  searchSymbols(searchTerm: string, options: QueryOptions): SymbolQueryRow[] {
    const query = this.buildSymbolLikeQuery(searchTerm, options);
    const params = this.buildSymbolParams(searchTerm, options);
    return this.db.prepare(query).all(...params) as SymbolQueryRow[];
  }

  private buildFileLikeQuery(searchTerm: string, options: QueryOptions): string {
    const isOrQuery = searchTerm.includes(' OR ');
    
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
      FROM files f
      WHERE (
    `;

    if (isOrQuery) {
      const terms = searchTerm.split(/\s+OR\s+/i);
      const conditions = terms.map(() => '(f.relative_path LIKE ? OR f.content LIKE ?)');
      query += conditions.join(' OR ');
    } else {
      query += 'f.relative_path LIKE ? OR f.content LIKE ?';
    }

    query += ')';

    if (options.fileTypes?.length) {
      query += ` AND f.language IN (${options.fileTypes.map(() => '?').join(',')})`;
    }

    query += ' ORDER BY f.relative_path LIMIT 10';
    return query;
  }

  private buildSymbolLikeQuery(searchTerm: string, options: QueryOptions): string {
    const isOrQuery = searchTerm.includes(' OR ');
    
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
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE (
    `;

    if (isOrQuery) {
      const terms = searchTerm.split(/\s+OR\s+/i);
      const conditions = terms.map(() => '(s.name LIKE ? OR s.signature LIKE ? OR s.documentation LIKE ?)');
      query += conditions.join(' OR ');
    } else {
      query += 's.name LIKE ? OR s.signature LIKE ? OR s.documentation LIKE ?';
    }

    query += ')';

    if (options.fileTypes?.length) {
      query += ` AND f.language IN (${options.fileTypes.map(() => '?').join(',')})`;
    }

    if (!isOrQuery) {
      const hasMultipleWords = searchTerm.trim().split(/\s+/).length > 1;
      if (hasMultipleWords) {
        query += ` ORDER BY 
          CASE WHEN LOWER(s.name) LIKE LOWER(?) THEN 0 ELSE 1 END,
          CASE WHEN LOWER(s.name) LIKE LOWER(?) THEN LENGTH(s.name) ELSE 999999 END`;
      } else {
        query += ` ORDER BY 
          CASE WHEN LOWER(s.name) = LOWER(?) THEN 0 ELSE 1 END,
          CASE WHEN LOWER(s.name) LIKE LOWER(?) THEN LENGTH(s.name) ELSE 999999 END`;
      }
    }

    query += ' LIMIT 20';
    return query;
  }

  private buildFileParams(searchTerm: string, options: QueryOptions): string[] {
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
    
    return params;
  }

  private buildSymbolParams(searchTerm: string, options: QueryOptions): string[] {
    const params: string[] = [];
    
    if (searchTerm.includes(' OR ')) {
      const terms = searchTerm.split(/\s+OR\s+/i);
      terms.forEach(term => {
        params.push(`%${term.trim()}%`, `%${term.trim()}%`, `%${term.trim()}%`);
      });
    } else {
      params.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
    }
    
    if (options.fileTypes?.length) {
      params.push(...options.fileTypes);
    }
    
    // Add parameters for ORDER BY (only for non-OR queries)
    if (!searchTerm.includes(' OR ')) {
      const hasMultipleWords = searchTerm.trim().split(/\s+/).length > 1;
      if (hasMultipleWords) {
        params.push(`%${searchTerm}%`, `%${searchTerm}%`);
      } else {
        params.push(searchTerm, `%${searchTerm}%`);
      }
    }
    
    return params;
  }
}

export class FilePathSearchStrategy implements SearchStrategy {
  constructor(private db: Database.Database) {}

  searchFiles(searchTerm: string, options: QueryOptions): FileQueryRow[] {
    const normalizedPath = this.normalizePath(searchTerm);
    
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
      FROM files f
      WHERE 
        f.relative_path LIKE ? OR 
        f.path LIKE ? OR
        f.relative_path = ? OR
        f.path = ?
    `;

    if (options.fileTypes?.length) {
      query += ` AND f.language IN (${options.fileTypes.map(t => `'${t}'`).join(',')})`;
    }

    query += ` ORDER BY 
      CASE 
        WHEN f.relative_path = ? OR f.path = ? THEN 0 
        WHEN f.relative_path LIKE ? THEN 1
        ELSE 2 
      END,
      LENGTH(f.relative_path)
      LIMIT 10`;

    const params = [
      `%${normalizedPath}%`,
      `%${normalizedPath}%`,
      normalizedPath,
      searchTerm,
      normalizedPath,
      searchTerm,
      `%${normalizedPath}`
    ];

    return this.db.prepare(query).all(...params) as FileQueryRow[];
  }

  searchSymbols(_searchTerm: string, _options: QueryOptions): SymbolQueryRow[] {
    // File path searches don't search for symbols
    return [];
  }

  private normalizePath(path: string): string {
    // Remove leading ./ or / and trailing extensions for better matching
    return path
      .replace(/^\.\//, '')
      .replace(/^\//, '')
      .replace(/\.[^/.]+$/, '');
  }
}