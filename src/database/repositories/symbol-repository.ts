import Database from 'better-sqlite3';
import type { 
  Symbol, SymbolRow, CallGraphRow, CallerQueryRow,
  SymbolLocationRow, SymbolQueryRow, SymbolLookupResult,
  SymbolWithFileContent, CallGraphResult, CallerResult
} from '../../types/index.js';

export class SymbolRepository {
  constructor(private db: Database.Database) {}

  findByName(name: string): SymbolRow | undefined {
    const stmt = this.db.prepare(`
      SELECT s.*, f.relative_path, f.path as file_path
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name = ?
      LIMIT 1
    `);
    return stmt.get(name) as SymbolRow | undefined;
  }

  findById(id: number): SymbolRow | undefined {
    const stmt = this.db.prepare(`
      SELECT s.*, f.relative_path, f.path as file_path
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.id = ?
    `);
    return stmt.get(id) as SymbolRow | undefined;
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
      AND s.name NOT IN ('default', 'exports', 'module.exports')
      AND s.type NOT IN ('export', 'import', 'require')
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

    if (options.ignoreTests) {
      conditions.push("f.relative_path NOT LIKE '%test%'");
      conditions.push("f.relative_path NOT LIKE '%spec%'");
      conditions.push("f.relative_path NOT LIKE '%__tests__%'");
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