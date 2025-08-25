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
    strict?: boolean;
    ignoreExported?: boolean;
  } = {}): SymbolRow[] {
    // More comprehensive query that checks both call_graph and references
    let query = `
      SELECT 
        s.id,
        s.name,
        s.type,
        f.path as file_path,
        s.line_start,
        s.line_end,
        f.relative_path,
        f.language,
        (s.line_end - s.line_start + 1) as line_count,
        -- Check if symbol is exported
        CASE 
          WHEN s.metadata LIKE '%"exported":true%' THEN 1
          ELSE 0
        END as is_exported
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.id NOT IN (
        -- Check call graph with both ID and name
        SELECT DISTINCT callee_symbol_id 
        FROM call_graph 
        WHERE callee_symbol_id IS NOT NULL
        
        UNION
        
        -- Also check by name in case IDs don't match
        SELECT DISTINCT s2.id
        FROM call_graph cg
        JOIN symbols s2 ON cg.callee_name = s2.name
        WHERE cg.callee_name IS NOT NULL
      )
      -- Always filter out imports/exports
      AND s.type NOT IN ('export', 'import', 'require')
    `;
    
    // Apply filters based on strict mode
    if (!options.strict) {
      query += `
      -- Filter out common false positives (non-strict mode)
      AND s.name NOT IN (
        'default', 'exports', 'module.exports',
        -- Common entry points (all languages)
        'main', 'index', 'app', 'App', 'Main',
        -- Python special methods and common patterns
        '__init__', '__main__', '__str__', '__repr__', '__eq__',
        '__hash__', '__call__', '__enter__', '__exit__', '__len__',
        '__getitem__', '__setitem__', '__delitem__', '__iter__',
        '__next__', '__contains__', '__add__', '__sub__', '__mul__',
        '__div__', '__mod__', '__pow__', '__lt__', '__le__', '__gt__',
        '__ge__', '__ne__', '__bool__', '__getattr__', '__setattr__',
        '__delattr__', '__new__', '__del__', '__bytes__', '__format__',
        '__sizeof__', '__reduce__', '__reduce_ex__', '__getstate__',
        '__setstate__', '__dir__', '__class_getitem__',
        -- Python common decorators and class methods
        'setUp', 'tearDown', 'setUpClass', 'tearDownClass',
        'classmethod', 'staticmethod', 'property',
        -- JavaScript/TypeScript React hooks and lifecycle
        'useEffect', 'useState', 'useMemo', 'useCallback', 'useReducer',
        'useContext', 'useRef', 'useLayoutEffect', 'useImperativeHandle',
        'useDebugValue', 'useDeferredValue', 'useTransition', 'useId',
        'componentDidMount', 'componentDidUpdate', 'componentWillUnmount',
        'shouldComponentUpdate', 'componentDidCatch', 'getDerivedStateFromProps',
        'getSnapshotBeforeUpdate', 'render',
        -- Vue.js lifecycle hooks
        'beforeCreate', 'created', 'beforeMount', 'mounted',
        'beforeUpdate', 'updated', 'beforeDestroy', 'destroyed',
        'activated', 'deactivated', 'errorCaptured',
        -- Angular lifecycle hooks
        'ngOnInit', 'ngOnChanges', 'ngDoCheck', 'ngAfterContentInit',
        'ngAfterContentChecked', 'ngAfterViewInit', 'ngAfterViewChecked',
        'ngOnDestroy',
        -- Go special methods
        'init', 'String', 'Error',
        -- Rust special methods and traits
        'new', 'default', 'fmt', 'clone', 'drop', 'from', 'into',
        -- Java special methods
        'toString', 'equals', 'hashCode', 'finalize', 'clone',
        'compareTo', 'main'
      )
      -- Filter out Python private (starts with _) but not dunder methods
      AND NOT (f.language = 'python' AND s.name LIKE '\_%' AND s.name NOT LIKE '\_\_%')
      -- Filter out test helpers
      AND s.name NOT LIKE '%Mock%'
      AND s.name NOT LIKE '%Stub%'
      AND s.name NOT LIKE '%Spy%'
      AND s.name NOT LIKE '%Fake%'
      -- Filter out common generated code patterns
      AND s.name NOT LIKE '%_pb2%'  -- Protocol buffers
      AND s.name NOT LIKE '%_grpc%' -- gRPC
      AND s.name NOT LIKE '%.g.%'   -- Generated files
      `;
    } else {
      // Strict mode - minimal filtering
      query += `
      -- Minimal filtering in strict mode
      AND s.name NOT IN ('default', 'exports', 'module.exports')
      `;
    }

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
      // Default to true - ignore test files for all languages
      conditions.push("f.relative_path NOT LIKE '%test%'");
      conditions.push("f.relative_path NOT LIKE '%spec%'");
      conditions.push("f.relative_path NOT LIKE '%__tests__%'");
      conditions.push("f.relative_path NOT LIKE '%.test.%'");
      conditions.push("f.relative_path NOT LIKE '%.spec.%'");
      // Python test patterns
      conditions.push("f.relative_path NOT LIKE '%test_%'");
      conditions.push("f.relative_path NOT LIKE '%_test.py'");
      conditions.push("f.relative_path NOT LIKE '%/tests/%'");
      // Go test patterns
      conditions.push("f.relative_path NOT LIKE '%_test.go'");
      // Rust test patterns
      conditions.push("f.relative_path NOT LIKE '%/tests.rs'");
      conditions.push("f.relative_path NOT LIKE '%_test.rs'");
      // Java test patterns
      conditions.push("f.relative_path NOT LIKE '%Test.java'");
      conditions.push("f.relative_path NOT LIKE '%Tests.java'");
      conditions.push("f.relative_path NOT LIKE '%/test/%'");
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

    // Filter out exported symbols by default (they might be used externally)
    if (options.ignoreExported !== false) {
      conditions.push(`(
        s.metadata IS NULL 
        OR s.metadata NOT LIKE '%"exported":true%'
        OR s.metadata NOT LIKE '%"isExported":true%'
      )`);
      // Also check common export patterns in symbol names/types
      conditions.push("s.type NOT IN ('export', 'exported_function', 'exported_class', 'public_method', 'public_function')");
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