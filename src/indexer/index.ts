import { PrimordynDB } from '../database/index.js';
import { FileScanner } from '../scanner/index.js';
import { ExtractorManager } from '../extractors/extractor-manager.js';
import ora from 'ora';
import chalk from 'chalk';
import { encodingForModel, Tiktoken } from 'js-tiktoken';
import type { FileInfo, ScanOptions, IndexOptions, IndexStats } from '../types/index.js';

export class Indexer {
  private db: PrimordynDB;
  private tokenEncoder: Tiktoken;
  private extractorManager: ExtractorManager;

  constructor(db: PrimordynDB) {
    this.db = db;
    // Use GPT-4 encoder as it's similar to Claude's tokenization
    this.tokenEncoder = encodingForModel('gpt-4');
    this.extractorManager = new ExtractorManager();
  }

  public async index(options: IndexOptions = {}): Promise<IndexStats> {
    const startTime = Date.now();
    const projectRoot = options.projectRoot || process.cwd();
    
    const spinner = options.verbose !== false 
      ? ora('Scanning project files...').start()
      : null;

    const stats: IndexStats = {
      filesIndexed: 0,
      symbolsExtracted: 0,
      totalTokens: 0,
      timeElapsed: 0,
      errors: 0
    };

    try {
      // Configure scanner
      const scanOptions: ScanOptions = {
        rootPath: projectRoot,
        ignorePatterns: options.ignorePatterns,
        includePatterns: options.languages || options.includePatterns || [],
        maxFileSize: options.maxFileSize,
        followSymlinks: options.followSymlinks
      };

      const scanner = new FileScanner(scanOptions);
      const files = await scanner.scan();

      if (spinner) {
        spinner.text = `Found ${files.length} files to index`;
      }

      // Process files in batches for better performance
      const batchSize = 10;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await Promise.all(batch.map(file => this.indexFile(file, stats, options)));

        if (spinner) {
          spinner.text = `Indexing files... ${Math.min(i + batchSize, files.length)}/${files.length}`;
        }
      }

      stats.timeElapsed = Date.now() - startTime;

      if (spinner) {
        spinner.succeed(
          chalk.green(`✓ Indexed ${stats.filesIndexed} files with ${stats.symbolsExtracted} symbols (${stats.totalTokens} tokens) in ${(stats.timeElapsed / 1000).toFixed(2)}s`)
        );
      }

      if (stats.errors > 0 && spinner) {
        console.log(chalk.yellow(`⚠ ${stats.errors} files could not be indexed`));
      }

    } catch (error) {
      if (spinner) {
        spinner.fail(chalk.red('Failed to index project'));
      }
      throw error;
    }

    return stats;
  }

  private async indexFile(fileInfo: FileInfo, stats: IndexStats, options: IndexOptions): Promise<void> {
    try {
      const database = this.db.getDatabase();

      // Check if file already exists
      const existing = database.prepare('SELECT id, hash FROM files WHERE path = ?').get(fileInfo.path) as { id: number; hash: string } | undefined;

      if (existing && existing.hash === fileInfo.hash && !options.updateExisting) {
        // File hasn't changed, skip
        return;
      }

      // Count tokens
      const tokens = this.countTokens(fileInfo.content);
      stats.totalTokens += tokens;

      // Extract context using the appropriate language extractor
      const context = await this.extractorManager.extract(fileInfo);

      // Begin transaction
      database.prepare('BEGIN').run();

      try {
        let fileId: number;

        if (existing) {
          // Update existing file
          database.prepare(`
            UPDATE files 
            SET content = ?, hash = ?, size = ?, language = ?, last_modified = ?, indexed_at = CURRENT_TIMESTAMP, metadata = ?
            WHERE id = ?
          `).run(
            fileInfo.content,
            fileInfo.hash,
            fileInfo.size,
            fileInfo.language,
            fileInfo.lastModified.toISOString(),
            JSON.stringify({ tokens, structure: context.structure }),
            existing.id
          );
          fileId = existing.id;

          // Delete old symbols
          database.prepare('DELETE FROM symbols WHERE file_id = ?').run(fileId);
        } else {
          // Insert new file
          const result = database.prepare(`
            INSERT INTO files (path, relative_path, content, hash, size, language, last_modified, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            fileInfo.path,
            fileInfo.relativePath,
            fileInfo.content,
            fileInfo.hash,
            fileInfo.size,
            fileInfo.language,
            fileInfo.lastModified.toISOString(),
            JSON.stringify({ tokens, structure: context.structure })
          );
          fileId = result.lastInsertRowid as number;
        }

        // Insert symbols
        const insertSymbol = database.prepare(`
          INSERT INTO symbols (file_id, name, type, line_start, line_end, signature, documentation, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const symbol of context.symbols) {
          insertSymbol.run(
            fileId,
            symbol.name,
            symbol.type,
            symbol.lineStart,
            symbol.lineEnd,
            symbol.signature,
            symbol.documentation || null,
            JSON.stringify(symbol.metadata || {})
          );
          stats.symbolsExtracted++;
        }

        // Store call relationships
        if (context.calls && context.calls.length > 0) {
          const insertCall = database.prepare(`
            INSERT INTO call_graph (
              caller_symbol_id, caller_file_id, callee_name, 
              callee_symbol_id, callee_file_id, call_type, 
              line_number, column_number
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          // For each call, try to find the caller symbol and callee symbol
          for (const call of context.calls) {
            // Find which symbol contains this call (the caller)
            let callerSymbolId: number | null = null;
            for (const symbol of context.symbols) {
              if (call.line >= symbol.lineStart && call.line <= symbol.lineEnd) {
                // Find the symbol's database ID
                const dbSymbol = database.prepare(
                  'SELECT id FROM symbols WHERE file_id = ? AND name = ? AND line_start = ?'
                ).get(fileId, symbol.name, symbol.lineStart) as { id: number } | undefined;
                if (dbSymbol) {
                  callerSymbolId = dbSymbol.id;
                  break;
                }
              }
            }

            // Try to find the callee symbol (might be in a different file)
            let calleeSymbolId: number | null = null;
            let calleeFileId: number | null = null;
            
            // First check if it's a local symbol in the same file
            const localCallee = database.prepare(
              'SELECT id FROM symbols WHERE file_id = ? AND name = ?'
            ).get(fileId, call.calleeName.split('.').pop()) as { id: number } | undefined;
            
            if (localCallee) {
              calleeSymbolId = localCallee.id;
              calleeFileId = fileId;
            } else if (!call.isExternal) {
              // Try to find it in other files (global search)
              const globalCallee = database.prepare(`
                SELECT s.id as symbol_id, s.file_id 
                FROM symbols s 
                WHERE s.name = ? 
                LIMIT 1
              `).get(call.calleeName.split('.').pop()) as { symbol_id: number; file_id: number } | undefined;
              
              if (globalCallee) {
                calleeSymbolId = globalCallee.symbol_id;
                calleeFileId = globalCallee.file_id;
              }
            }

            // Insert the call relationship
            insertCall.run(
              callerSymbolId,
              fileId,
              call.calleeName,
              calleeSymbolId,
              calleeFileId,
              call.callType,
              call.line,
              call.column || null
            );
          }
        }

        // Store imports/exports in metadata
        if (context.imports.length > 0 || context.exports.length > 0) {
          database.prepare(`
            UPDATE files 
            SET metadata = json_patch(metadata, ?)
            WHERE id = ?
          `).run(
            JSON.stringify({ imports: context.imports, exports: context.exports }),
            fileId
          );
        }

        database.prepare('COMMIT').run();
        stats.filesIndexed++;

      } catch (error) {
        database.prepare('ROLLBACK').run();
        throw error;
      }

    } catch (error) {
      stats.errors++;
      if (options.verbose) {
        console.error(chalk.red(`Error indexing ${fileInfo.relativePath}:`), error);
      }
    }
  }

  private countTokens(text: string): number {
    try {
      return this.tokenEncoder.encode(text).length;
    } catch {
      // Fallback: rough estimation (1 token ≈ 4 characters)
      return Math.ceil(text.length / 4);
    }
  }

  public async getIndexStats(): Promise<{
    totalFiles: number;
    totalSymbols: number;
    totalTokens: number;
    languages: { language: string; count: number }[];
    largestFiles: { path: string; size: number; tokens: number }[];
  }> {
    const database = this.db.getDatabase();

    const totalFiles = (database.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number }).count;
    const totalSymbols = (database.prepare('SELECT COUNT(*) as count FROM symbols').get() as { count: number }).count;
    
    const totalTokens = (database.prepare(`
      SELECT SUM(json_extract(metadata, '$.tokens')) as total FROM files
    `).get() as { total: number }).total || 0;

    const languages = database.prepare(`
      SELECT language, COUNT(*) as count 
      FROM files 
      WHERE language IS NOT NULL 
      GROUP BY language 
      ORDER BY count DESC
    `).all() as { language: string; count: number }[];

    const largestFiles = database.prepare(`
      SELECT 
        relative_path as path, 
        size, 
        json_extract(metadata, '$.tokens') as tokens
      FROM files 
      ORDER BY size DESC 
      LIMIT 10
    `).all() as { path: string; size: number; tokens: number }[];

    return {
      totalFiles,
      totalSymbols,
      totalTokens,
      languages,
      largestFiles
    };
  }

  public async clearIndex(): Promise<void> {
    const database = this.db.getDatabase();
    database.prepare('DELETE FROM call_graph').run();
    database.prepare('DELETE FROM symbols').run();
    database.prepare('DELETE FROM files').run();
    database.prepare('DELETE FROM context_cache').run();
  }
}