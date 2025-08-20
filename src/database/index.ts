import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { DatabaseInfo } from '../types/index.js';

export class PrimordynDB {
  private db: Database.Database;
  private dbPath: string;

  constructor(projectPath: string = process.cwd()) {
    const dbDir = join(projectPath, '.primordyn');
    
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = join(dbDir, 'context.db');
    this.db = new Database(this.dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
    
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        relative_path TEXT NOT NULL,
        content TEXT NOT NULL,
        hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        language TEXT,
        last_modified TEXT NOT NULL,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        signature TEXT,
        documentation TEXT,
        metadata TEXT,
        FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS context_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_hash TEXT UNIQUE NOT NULL,
        result TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      );

      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
      CREATE INDEX IF NOT EXISTS idx_files_relative_path ON files(relative_path);
      CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
      CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type);
      CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
      CREATE INDEX IF NOT EXISTS idx_context_cache_query_hash ON context_cache(query_hash);
      CREATE INDEX IF NOT EXISTS idx_context_cache_expires_at ON context_cache(expires_at);

      -- Full-text search indexes
      CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
        relative_path, content, language,
        content='files',
        content_rowid='id'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
        name, signature, documentation,
        content='symbols', 
        content_rowid='id'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS files_fts_insert AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(rowid, relative_path, content, language) 
        VALUES (new.id, new.relative_path, new.content, new.language);
      END;

      CREATE TRIGGER IF NOT EXISTS files_fts_delete AFTER DELETE ON files BEGIN
        DELETE FROM files_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS files_fts_update AFTER UPDATE ON files BEGIN
        DELETE FROM files_fts WHERE rowid = old.id;
        INSERT INTO files_fts(rowid, relative_path, content, language) 
        VALUES (new.id, new.relative_path, new.content, new.language);
      END;

      CREATE TRIGGER IF NOT EXISTS symbols_fts_insert AFTER INSERT ON symbols BEGIN
        INSERT INTO symbols_fts(rowid, name, signature, documentation) 
        VALUES (new.id, new.name, new.signature, new.documentation);
      END;

      CREATE TRIGGER IF NOT EXISTS symbols_fts_delete AFTER DELETE ON symbols BEGIN
        DELETE FROM symbols_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS symbols_fts_update AFTER UPDATE ON symbols BEGIN
        DELETE FROM symbols_fts WHERE rowid = old.id;
        INSERT INTO symbols_fts(rowid, name, signature, documentation) 
        VALUES (new.id, new.name, new.signature, new.documentation);
      END;
    `);
  }

  public getDatabase(): Database.Database {
    return this.db;
  }

  public getDatabasePath(): string {
    return this.dbPath;
  }

  public async getDatabaseInfo(): Promise<DatabaseInfo> {
    const fileCount = (this.db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number }).count;
    const symbolCount = (this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as { count: number }).count;
    const totalSize = (this.db.prepare('SELECT SUM(size) as total FROM files').get() as { total: number }).total || 0;
    
    const lastIndexedRow = this.db.prepare('SELECT MAX(indexed_at) as last FROM files').get() as { last: string | null };
    const lastIndexed = lastIndexedRow?.last ? new Date(lastIndexedRow.last) : null;

    return {
      fileCount,
      symbolCount,
      totalSize,
      lastIndexed
    };
  }

  public cleanupExpiredCache(): void {
    this.db.prepare('DELETE FROM context_cache WHERE expires_at < datetime("now")').run();
  }

  public vacuum(): void {
    this.db.exec('VACUUM');
  }

  public close(): void {
    this.db.close();
  }
}