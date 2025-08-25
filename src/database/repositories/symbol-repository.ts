import Database from 'better-sqlite3';
import { BaseRepository } from './base-repository.js';
import type { 
  SymbolRow, SymbolWithFileContent, CallGraphResult, CallerResult
} from '../../types/index.js';

export class SymbolRepository extends BaseRepository<SymbolRow> {
  constructor(db: Database.Database) {
    super(db, 500, 10 * 60 * 1000); // 500 items, 10 minute TTL
  }

  findByName(name: string): SymbolRow | undefined {
    const cacheKey = this.buildCacheKey('name', name);
    return this.getCached(cacheKey, () => {
      const stmt = this.db.prepare(`
        SELECT s.*, f.relative_path, f.path as file_path
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE s.name = ?
        LIMIT 1
      `);
      return stmt.get(name) as SymbolRow | undefined;
    });
  }

  findById(id: number): SymbolRow | undefined {
    const cacheKey = this.buildCacheKey('id', id);
    return this.getCached(cacheKey, () => {
      const stmt = this.db.prepare(`
        SELECT s.*, f.relative_path, f.path as file_path
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE s.id = ?
      `);
      return stmt.get(id) as SymbolRow | undefined;
    });
  }

  findByType(type: string, limit?: number): SymbolRow[] {
    let query = `
      SELECT s.*, f.relative_path, f.path as file_path
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.type = ?
    `;
    if (limit) query += ` LIMIT ${limit}`;
    
    const stmt = this.db.prepare(query);
    return stmt.all(type) as SymbolRow[];
  }

  findWithContent(name: string): SymbolWithFileContent | undefined {
    const stmt = this.db.prepare(`
      SELECT s.*, f.relative_path, f.path as file_path, f.content as file_content
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name = ?
      LIMIT 1
    `);
    return stmt.get(name) as SymbolWithFileContent | undefined;
  }

  findAllWithContent(type?: string): SymbolWithFileContent[] {
    let query = `
      SELECT s.*, f.relative_path, f.path as file_path, f.content as file_content
      FROM symbols s
      JOIN files f ON s.file_id = f.id
    `;
    if (type) {
      query += ` WHERE s.type = ?`;
      const stmt = this.db.prepare(query);
      return stmt.all(type) as SymbolWithFileContent[];
    }
    const stmt = this.db.prepare(query);
    return stmt.all() as SymbolWithFileContent[];
  }

  findUnused(options: {
    type?: string;
    file?: string;
    ignoreTests?: boolean;
    minLines?: number;
    ignoreDocs?: boolean;
    ignoreExamples?: boolean;
    ignoreConfig?: boolean;
    customIgnore?: string[];
  } = {}): SymbolRow[] {
    let query = `
      SELECT 
        s.id,
        s.name,
        s.type,
        f.path as file_path,
        s.line_start,
        s.line_end,
        f.relative_path,
        (s.line_end - s.line_start + 1) as line_count
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.id NOT IN (
        SELECT DISTINCT callee_symbol_id 
        FROM call_graph 
        WHERE callee_symbol_id IS NOT NULL
      )
      -- Filter out common false positives
      AND s.name NOT IN (
        'default', 'exports', 'module.exports',
        -- Common entry points and configs
        'main', 'index', 'app', 'App', 'config', 'Config',
        -- React components that may be lazy loaded
        'render', 'Component', 'Provider',
        -- CLI and scripts
        'cli', 'run', 'start', 'build', 'serve',
        -- Event handlers that might be bound dynamically
        'onClick', 'onChange', 'onSubmit', 'onLoad', 'onError',
        -- Common lifecycle methods
        'constructor', 'componentDidMount', 'componentWillUnmount',
        'useEffect', 'useState', 'useMemo', 'useCallback'
      )
      AND s.type NOT IN ('export', 'import', 'require')
      -- Filter out symbols that start with underscore (private convention)
      AND s.name NOT LIKE '\_%'
      -- Filter out test helpers and mocks
      AND s.name NOT LIKE '%Mock%'
      AND s.name NOT LIKE '%Stub%'
      AND s.name NOT LIKE '%Fake%'
      AND s.name NOT LIKE '%Test%'
      AND s.name NOT LIKE '%Spec%'
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    if (options.type) {
      conditions.push('s.type = ?');
      params.push(options.type);
    }

    if (options.file) {
      conditions.push('f.relative_path LIKE ?');
      params.push(`%${options.file}%`);
    }

    if (options.ignoreTests !== false) {
      // Default to true - ignore test files
      conditions.push("f.relative_path NOT LIKE '%test%'");
      conditions.push("f.relative_path NOT LIKE '%spec%'");
      conditions.push("f.relative_path NOT LIKE '%__tests__%'");
      conditions.push("f.relative_path NOT LIKE '%.test.%'");
      conditions.push("f.relative_path NOT LIKE '%.spec.%'");
    }

    if (options.ignoreDocs !== false) {
      // Default to true - ignore documentation files
      conditions.push("f.relative_path NOT LIKE '%/docs/%'");
      conditions.push("f.relative_path NOT LIKE '%/documentation/%'");
      conditions.push("f.relative_path NOT LIKE '%.md'");
      conditions.push("f.relative_path NOT LIKE '%README%'");
      conditions.push("f.relative_path NOT LIKE '%CHANGELOG%'");
      conditions.push("f.relative_path NOT LIKE '%LICENSE%'");
    }

    if (options.ignoreExamples !== false) {
      // Default to true - ignore example files
      conditions.push("f.relative_path NOT LIKE '%/examples/%'");
      conditions.push("f.relative_path NOT LIKE '%/example/%'");
      conditions.push("f.relative_path NOT LIKE '%/samples/%'");
      conditions.push("f.relative_path NOT LIKE '%/demo/%'");
      conditions.push("f.relative_path NOT LIKE '%.example.%'");
    }

    if (options.ignoreConfig !== false) {
      // Default to true - ignore config files
      conditions.push("f.relative_path NOT LIKE '%.config.%'");
      conditions.push("f.relative_path NOT LIKE '%webpack.%'");
      conditions.push("f.relative_path NOT LIKE '%rollup.%'");
      conditions.push("f.relative_path NOT LIKE '%vite.%'");
      conditions.push("f.relative_path NOT LIKE '%jest.%'");
      conditions.push("f.relative_path NOT LIKE '%babel.%'");
      conditions.push("f.relative_path NOT LIKE '%eslint%'");
      conditions.push("f.relative_path NOT LIKE '%prettier%'");
      conditions.push("f.relative_path NOT LIKE '%tsconfig%'");
    }

    // Custom ignore patterns
    if (options.customIgnore && options.customIgnore.length > 0) {
      for (const pattern of options.customIgnore) {
        conditions.push('f.relative_path NOT LIKE ?');
        params.push(`%${pattern}%`);
      }
    }

    if (options.minLines) {
      conditions.push('(s.line_end - s.line_start + 1) >= ?');
      params.push(options.minLines);
    }

    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }

    query += ' ORDER BY f.relative_path, s.line_start';

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as SymbolRow[];
  }

  getCallGraph(symbolId: number): CallGraphResult[] {
    const stmt = this.db.prepare(`
      SELECT 
        s.name,
        s.type,
        f.relative_path as file,
        s.line_start as line
      FROM call_graph cg
      JOIN symbols s ON cg.callee_symbol_id = s.id
      JOIN files f ON s.file_id = f.id
      WHERE cg.caller_symbol_id = ?
    `);
    return stmt.all(symbolId) as CallGraphResult[];
  }

  getCallers(symbolId: number): CallerResult[] {
    const stmt = this.db.prepare(`
      SELECT 
        s.name,
        s.type,
        f.relative_path as file,
        s.line_start as line
      FROM call_graph cg
      JOIN symbols s ON cg.caller_symbol_id = s.id
      JOIN files f ON s.file_id = f.id
      WHERE cg.callee_symbol_id = ?
    `);
    return stmt.all(symbolId) as CallerResult[];
  }

  getCallGraphWithDepth(symbolId: number, maxDepth: number, reverse: boolean = false): any[] {
    const visited = new Set<number>();
    const result: any[] = [];

    const traverse = (id: number, depth: number) => {
      if (depth > maxDepth || visited.has(id)) return;
      visited.add(id);

      const query = reverse ? `
        SELECT 
          s.id,
          s.name,
          s.type,
          f.relative_path as file,
          s.line_start as line
        FROM call_graph cg
        JOIN symbols s ON cg.caller_symbol_id = s.id
        JOIN files f ON s.file_id = f.id
        WHERE cg.callee_symbol_id = ?
      ` : `
        SELECT 
          s.id,
          s.name,
          s.type,
          f.relative_path as file,
          s.line_start as line
        FROM call_graph cg
        JOIN symbols s ON cg.callee_symbol_id = s.id
        JOIN files f ON s.file_id = f.id
        WHERE cg.caller_symbol_id = ?
      `;

      const stmt = this.db.prepare(query);
      const deps = stmt.all(id) as any[];

      for (const dep of deps) {
        result.push({ ...dep, depth });
        traverse(dep.id, depth + 1);
      }
    };

    traverse(symbolId, 0);
    return result;
  }

  searchByPattern(pattern: string, type?: string): SymbolRow[] {
    let query = `
      SELECT s.*, f.relative_path, f.path as file_path
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name LIKE ?
    `;
    
    const params: any[] = [`%${pattern}%`];
    
    if (type) {
      query += ' AND s.type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY s.name LIMIT 100';
    
    const stmt = this.db.prepare(query);
    return stmt.all(...params) as SymbolRow[];
  }

  findSimilar(targetSymbol: SymbolRow, limit: number = 10): SymbolRow[] {
    const stmt = this.db.prepare(`
      SELECT s.*, f.relative_path, f.path as file_path
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.type = ?
        AND s.id != ?
        AND (s.line_end - s.line_start) BETWEEN ? AND ?
      LIMIT ?
    `);
    
    const lineCount = targetSymbol.line_end - targetSymbol.line_start;
    const minLines = Math.max(1, lineCount - 10);
    const maxLines = lineCount + 10;
    
    return stmt.all(
      targetSymbol.type,
      targetSymbol.id,
      minLines,
      maxLines,
      limit
    ) as SymbolRow[];
  }

  getCircularDependencies(maxDepth: number = 10): any[] {
    const stmt = this.db.prepare(`
      SELECT 
        cg1.caller_symbol_id as source_id,
        s1.name as source_name,
        s1.type as source_type,
        f1.relative_path as source_file,
        cg1.callee_symbol_id as target_id,
        s2.name as target_name,
        s2.type as target_type,
        f2.relative_path as target_file
      FROM call_graph cg1
      JOIN symbols s1 ON cg1.caller_symbol_id = s1.id
      JOIN files f1 ON s1.file_id = f1.id
      JOIN symbols s2 ON cg1.callee_symbol_id = s2.id
      JOIN files f2 ON s2.file_id = f2.id
      WHERE s2.id IS NOT NULL
    `);
    
    return stmt.all() as any[];
  }

  countByType(): Record<string, number> {
    const stmt = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM symbols
      GROUP BY type
      ORDER BY count DESC
    `);
    
    const results = stmt.all() as Array<{ type: string; count: number }>;
    return Object.fromEntries(results.map(r => [r.type, r.count]));
  }

  getTotalCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM symbols');
    const result = stmt.get() as { count: number };
    return result.count;
  }
}