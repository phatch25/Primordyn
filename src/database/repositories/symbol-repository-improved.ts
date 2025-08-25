import Database from 'better-sqlite3';
import type { SymbolRow } from '../../types/index.js';

export class ImprovedSymbolRepository {
  constructor(private db: Database.Database) {}

  /**
   * Find truly unused symbols by checking multiple reference types
   */
  findUnusedImproved(options: {
    type?: string;
    file?: string;
    ignoreTests?: boolean;
    minLines?: number;
    strict?: boolean;
  } = {}): SymbolRow[] {
    // Build a comprehensive list of used symbol IDs
    const usedSymbolIds = new Set<number>();
    
    // 1. Check call_graph for direct calls
    const directCalls = this.db.prepare(`
      SELECT DISTINCT callee_symbol_id 
      FROM call_graph 
      WHERE callee_symbol_id IS NOT NULL
    `).all() as Array<{ callee_symbol_id: number }>;
    
    directCalls.forEach(row => usedSymbolIds.add(row.callee_symbol_id));
    
    // 2. Check for class instantiations (new ClassName)
    const classInstantiations = this.db.prepare(`
      SELECT DISTINCT s.id
      FROM symbols s
      WHERE s.type = 'class'
      AND EXISTS (
        SELECT 1 FROM call_graph cg
        WHERE cg.callee_name = s.name
        AND cg.call_type IN ('instantiation', 'constructor', 'new')
      )
    `).all() as Array<{ id: number }>;
    
    classInstantiations.forEach(row => usedSymbolIds.add(row.id));
    
    // 3. Check for constructor usage (classes with used constructors are used)
    const constructorsUsed = this.db.prepare(`
      SELECT DISTINCT s.file_id, s.name
      FROM symbols s
      WHERE s.type = 'method' 
      AND s.name = 'constructor'
      AND s.file_id IN (
        SELECT DISTINCT caller_file_id 
        FROM call_graph 
        WHERE callee_name IN (
          SELECT name FROM symbols WHERE type = 'class'
        )
      )
    `).all() as Array<{ file_id: number; name: string }>;
    
    // Mark the parent class and constructor as used
    constructorsUsed.forEach(row => {
      const parentClass = this.db.prepare(`
        SELECT id FROM symbols 
        WHERE file_id = ? 
        AND type = 'class'
        AND line_start < (
          SELECT line_start FROM symbols 
          WHERE file_id = ? 
          AND name = 'constructor' 
          AND type = 'method'
          LIMIT 1
        )
        ORDER BY line_start DESC
        LIMIT 1
      `).get(row.file_id, row.file_id) as { id: number } | undefined;
      
      if (parentClass) {
        usedSymbolIds.add(parentClass.id);
      }
      
      // Also mark the constructor itself as used
      const constructor = this.db.prepare(`
        SELECT id FROM symbols 
        WHERE file_id = ? 
        AND name = 'constructor' 
        AND type = 'method'
      `).all(row.file_id) as Array<{ id: number }>;
      
      constructor.forEach(c => usedSymbolIds.add(c.id));
    });
    
    // 4. Check for exported symbols (they might be used externally)
    const exported = this.db.prepare(`
      SELECT id FROM symbols 
      WHERE metadata LIKE '%"exported":true%'
      OR metadata LIKE '%"isExported":true%'
    `).all() as Array<{ id: number }>;
    
    exported.forEach(row => usedSymbolIds.add(row.id));
    
    // 5. Check for text references (fallback for dynamic usage)
    const allSymbols = this.db.prepare(`
      SELECT id, name, type FROM symbols
      WHERE type IN ('class', 'function', 'interface', 'type')
    `).all() as Array<{ id: number; name: string; type: string }>;
    
    for (const symbol of allSymbols) {
      // Check if symbol name appears in any file content
      const references = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM files
        WHERE content LIKE ?
        AND id != (SELECT file_id FROM symbols WHERE id = ?)
      `).get(`%${symbol.name}%`, symbol.id) as { count: number };
      
      if (references.count > 0) {
        usedSymbolIds.add(symbol.id);
      }
    }
    
    // Now find symbols that are NOT in the used set
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
      WHERE s.id NOT IN (${Array.from(usedSymbolIds).join(',') || '0'})
      AND s.type NOT IN ('export', 'import', 'require')
    `;
    
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (options.type) {
      conditions.push('s.type = ?');
      params.push(options.type);
    }
    
    if (options.file) {
      conditions.push('f.relative_path LIKE ?');
      params.push(`%${options.file}%`);
    }
    
    if (options.ignoreTests !== false) {
      conditions.push("f.relative_path NOT LIKE '%test%'");
      conditions.push("f.relative_path NOT LIKE '%spec%'");
    }
    
    if (options.minLines) {
      conditions.push('(s.line_end - s.line_start + 1) >= ?');
      params.push(options.minLines);
    }
    
    if (!options.strict) {
      // Filter out common entry points and lifecycle methods
      conditions.push(`s.name NOT IN (
        'default', 'main', 'index', 'app', 'App',
        'constructor', 'render', 'componentDidMount',
        'ngOnInit', 'onCreate', 'init'
      )`);
    }
    
    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY f.relative_path, s.line_start';
    
    return this.db.prepare(query).all(...params) as SymbolRow[];
  }
}