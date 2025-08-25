import Database from 'better-sqlite3';
import type { FileRow, FileQueryRow, FileResult } from '../../types/index.js';

export class FileRepository {
  constructor(private db: Database.Database) {}

  findById(id: number): FileRow | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM files WHERE id = ?
    `);
    return stmt.get(id) as FileRow | undefined;
  }

  findByPath(path: string): FileRow | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM files WHERE path = ? OR relative_path = ?
    `);
    return stmt.get(path, path) as FileRow | undefined;
  }

  findByHash(hash: string): FileRow | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM files WHERE hash = ?
    `);
    return stmt.get(hash) as FileRow | undefined;
  }

  searchByPattern(pattern: string): FileRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM files 
      WHERE relative_path LIKE ? 
      ORDER BY relative_path
      LIMIT 100
    `);
    return stmt.all(`%${pattern}%`) as FileRow[];
  }

  findByLanguage(language: string): FileRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM files 
      WHERE language = ? 
      ORDER BY relative_path
    `);
    return stmt.all(language) as FileRow[];
  }

  getAll(): FileRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM files ORDER BY relative_path
    `);
    return stmt.all() as FileRow[];
  }

  getAllWithSymbolCount(): Array<FileRow & { symbol_count: number }> {
    const stmt = this.db.prepare(`
      SELECT 
        f.*,
        COUNT(s.id) as symbol_count
      FROM files f
      LEFT JOIN symbols s ON f.id = s.file_id
      GROUP BY f.id
      ORDER BY f.relative_path
    `);
    return stmt.all() as Array<FileRow & { symbol_count: number }>;
  }

  insert(file: Omit<FileRow, 'id' | 'indexed_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, relative_path, content, language, size, hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      file.path,
      file.relative_path,
      file.content,
      file.language,
      file.size,
      file.hash
    );
    
    return result.lastInsertRowid as number;
  }

  update(id: number, file: Partial<FileRow>): boolean {
    const fields: string[] = [];
    const values: any[] = [];
    
    if (file.content !== undefined) {
      fields.push('content = ?');
      values.push(file.content);
    }
    if (file.hash !== undefined) {
      fields.push('hash = ?');
      values.push(file.hash);
    }
    if (file.size !== undefined) {
      fields.push('size = ?');
      values.push(file.size);
    }
    if (file.language !== undefined) {
      fields.push('language = ?');
      values.push(file.language);
    }
    
    if (fields.length === 0) return false;
    
    fields.push('indexed_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    const stmt = this.db.prepare(`
      UPDATE files 
      SET ${fields.join(', ')}
      WHERE id = ?
    `);
    
    const result = stmt.run(...values);
    return result.changes > 0;
  }

  delete(id: number): boolean {
    const stmt = this.db.prepare('DELETE FROM files WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  deleteByPath(path: string): boolean {
    const stmt = this.db.prepare('DELETE FROM files WHERE path = ?');
    const result = stmt.run(path);
    return result.changes > 0;
  }

  getTotalSize(): number {
    const stmt = this.db.prepare('SELECT SUM(size) as total FROM files');
    const result = stmt.get() as { total: number | null };
    return result.total || 0;
  }

  getTotalCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM files');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  getLanguageStats(): Array<{ language: string; count: number; total_size: number }> {
    const stmt = this.db.prepare(`
      SELECT 
        language,
        COUNT(*) as count,
        SUM(size) as total_size
      FROM files
      GROUP BY language
      ORDER BY count DESC
    `);
    return stmt.all() as Array<{ language: string; count: number; total_size: number }>;
  }
}