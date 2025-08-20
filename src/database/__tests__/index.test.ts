import { PrimordynDB } from '../index.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

describe('PrimordynDB', () => {
  const testDir = join(process.cwd(), '.test-primordyn');
  let db: PrimordynDB;

  beforeEach(() => {
    // Clean up test directory if it exists
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    db = new PrimordynDB(testDir);
  });

  afterEach(() => {
    db.close();
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should create database file', () => {
    const dbPath = db.getDatabasePath();
    expect(existsSync(dbPath)).toBe(true);
  });

  test('should initialize schema correctly', () => {
    const database = db.getDatabase();
    
    // Check if tables exist
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as { name: string }[];
    
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('files');
    expect(tableNames).toContain('symbols');
    expect(tableNames).toContain('context_cache');
    expect(tableNames).toContain('call_graph');
  });

  test('should return database info', async () => {
    const info = await db.getDatabaseInfo();
    
    expect(info).toHaveProperty('fileCount');
    expect(info).toHaveProperty('symbolCount');
    expect(info).toHaveProperty('totalSize');
    expect(info).toHaveProperty('lastIndexed');
    
    expect(info.fileCount).toBe(0);
    expect(info.symbolCount).toBe(0);
    expect(info.totalSize).toBe(0);
    expect(info.lastIndexed).toBeNull();
  });

  test('should insert and retrieve file', () => {
    const database = db.getDatabase();
    
    // Insert a test file
    const result = database.prepare(`
      INSERT INTO files (path, relative_path, content, hash, size, language, last_modified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      '/test/file.ts',
      'file.ts',
      'const test = 1;',
      'hash123',
      15,
      'typescript',
      new Date().toISOString()
    );
    
    expect(result.changes).toBe(1);
    
    // Retrieve the file
    const file = database.prepare('SELECT * FROM files WHERE path = ?')
      .get('/test/file.ts') as any;
    
    expect(file).toBeTruthy();
    expect(file.content).toBe('const test = 1;');
    expect(file.language).toBe('typescript');
  });

  test('should handle cleanup of expired cache', () => {
    const database = db.getDatabase();
    
    // Insert expired cache entry
    database.prepare(`
      INSERT INTO context_cache (query_hash, result, expires_at)
      VALUES (?, ?, datetime('now', '-1 day'))
    `).run('test_hash', '{"test": true}');
    
    // Insert valid cache entry
    database.prepare(`
      INSERT INTO context_cache (query_hash, result, expires_at)
      VALUES (?, ?, datetime('now', '+1 day'))
    `).run('valid_hash', '{"valid": true}');
    
    // Check both exist
    let count = (database.prepare('SELECT COUNT(*) as count FROM context_cache')
      .get() as { count: number }).count;
    expect(count).toBe(2);
    
    // Clean up expired
    db.cleanupExpiredCache();
    
    // Check only valid remains
    count = (database.prepare('SELECT COUNT(*) as count FROM context_cache')
      .get() as { count: number }).count;
    expect(count).toBe(1);
    
    const remaining = database.prepare('SELECT query_hash FROM context_cache')
      .get() as { query_hash: string };
    expect(remaining.query_hash).toBe('valid_hash');
  });
});