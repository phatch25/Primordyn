import { readdir, stat, readFile } from 'fs/promises';
import { join, relative, extname, basename } from 'path';
import { createHash } from 'crypto';
import ignore from 'ignore';
import { existsSync, readFileSync } from 'fs';
import type { FileInfo, ScanOptions } from '../types/index.js';

export const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyx': 'python',
  '.pyi': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.sc': 'scala',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'csharp',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.fsi': 'fsharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.m': 'objective-c',
  '.mm': 'objective-cpp',
  '.dart': 'dart',
  '.lua': 'lua',
  '.r': 'r',
  '.R': 'r',
  '.jl': 'julia',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.elm': 'elm',
  '.purs': 'purescript',
  '.nim': 'nim',
  '.nims': 'nim',
  '.zig': 'zig',
  '.v': 'vlang',
  '.sv': 'systemverilog',
  '.svh': 'systemverilog',
  '.vhd': 'vhdl',
  '.vhdl': 'vhdl',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.json': 'json',
  '.xml': 'xml',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.rst': 'restructuredtext',
  '.tex': 'latex',
  '.dockerfile': 'dockerfile',
  '.proto': 'protobuf',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.sol': 'solidity'
};

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  'node_modules/**',
  '**/node_modules',
  '**/node_modules/**',
  '.git/**',
  '.svn/**',
  '.hg/**',
  '.primordyn/**',
  '.eryndralis/**',
  'dist',
  'dist/**',
  '**/dist',
  '**/dist/**',
  'build',
  'build/**',
  '**/build',
  '**/build/**',
  'out/**',
  'target/**',
  '*.pyc',
  '__pycache__/**',
  '.pytest_cache/**',
  '.venv',
  '.venv/**',
  'venv',
  'venv/**',
  'env',
  'env/**',
  '.env',
  '.env/**',
  '**/.venv',
  '**/.venv/**',
  '**/venv',
  '**/venv/**',
  '**/env',
  '**/env/**',
  'vendor/**',
  'Pods/**',
  '.gradle/**',
  '.idea/**',
  '.vscode/**',
  '.vs/**',
  '*.class',
  '*.jar',
  '*.war',
  '*.ear',
  '*.dll',
  '*.exe',
  '*.so',
  '*.dylib',
  '*.a',
  '*.o',
  '*.obj',
  '*.pdb',
  '*.idb',
  '*.suo',
  '*.log',
  '*.tmp',
  '*.temp',
  '*.swp',
  '*.swo',
  '*.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
  '*.min.js',
  '*.min.css',
  '*.map'
];

export class FileScanner {
  private ignorer: ReturnType<typeof ignore>;
  private options: Required<ScanOptions>;

  constructor(options: ScanOptions) {
    this.options = {
      rootPath: options.rootPath,
      ignorePatterns: options.ignorePatterns || DEFAULT_IGNORE_PATTERNS,
      includePatterns: options.includePatterns || [],
      maxFileSize: options.maxFileSize || 1024 * 1024, // 1MB default
      followSymlinks: options.followSymlinks || false
    };

    this.ignorer = ignore();
    this.loadIgnoreFiles();
    this.ignorer.add(this.options.ignorePatterns);
  }

  private loadIgnoreFiles(): void {
    const gitignorePath = join(this.options.rootPath, '.gitignore');
    if (existsSync(gitignorePath)) {
      try {
        const gitignoreContent = readFileSync(gitignorePath, 'utf-8');
        this.ignorer.add(gitignoreContent);
      } catch {
        // Ignore errors reading .gitignore
      }
    }

    const primordynIgnorePath = join(this.options.rootPath, '.primordynignore');
    if (existsSync(primordynIgnorePath)) {
      try {
        const ignoreContent = readFileSync(primordynIgnorePath, 'utf-8');
        this.ignorer.add(ignoreContent);
      } catch {
        // Ignore errors reading .primordynignore
      }
    }
  }

  public async scan(): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    await this.scanDirectory(this.options.rootPath, files);
    return files;
  }

  private async scanDirectory(dirPath: string, files: FileInfo[]): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relativePath = relative(this.options.rootPath, fullPath);

      if (this.ignorer.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, files);
      } else if (entry.isFile() || (entry.isSymbolicLink() && this.options.followSymlinks)) {
        const fileInfo = await this.processFile(fullPath, relativePath);
        if (fileInfo) {
          files.push(fileInfo);
        }
      }
    }
  }

  private async processFile(fullPath: string, relativePath: string): Promise<FileInfo | null> {
    try {
      const stats = await stat(fullPath);

      if (stats.size > this.options.maxFileSize) {
        return null;
      }

      if (this.options.includePatterns.length > 0) {
        const ext = extname(fullPath).toLowerCase();
        const lang = LANGUAGE_MAP[ext];
        if (!lang || !this.options.includePatterns.some(pattern => 
          lang.includes(pattern) || ext.includes(pattern) || relativePath.includes(pattern)
        )) {
          return null;
        }
      }

      const content = await readFile(fullPath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      const language = this.detectLanguage(fullPath);

      return {
        path: fullPath,
        relativePath,
        content,
        hash,
        size: stats.size,
        language,
        lastModified: stats.mtime
      };
    } catch {
      // Skip files that can't be read (binary files, permission issues, etc.)
      return null;
    }
  }

  private detectLanguage(filePath: string): string | null {
    const ext = extname(filePath).toLowerCase();
    
    // Check extension first
    if (LANGUAGE_MAP[ext]) {
      return LANGUAGE_MAP[ext];
    }

    // Check special file names
    const basenameStr = basename(filePath).toLowerCase();
    if (basenameStr === 'dockerfile' || basenameStr.startsWith('dockerfile.')) {
      return 'dockerfile';
    }
    if (basenameStr === 'makefile' || basenameStr === 'gnumakefile') {
      return 'makefile';
    }
    if (basenameStr === 'rakefile') {
      return 'ruby';
    }
    if (basenameStr === 'gemfile') {
      return 'ruby';
    }
    if (basenameStr === 'pipfile') {
      return 'toml';
    }
    if (basenameStr === 'cargo.toml') {
      return 'toml';
    }
    if (basenameStr === 'package.json' || basenameStr === 'tsconfig.json') {
      return 'json';
    }

    return null;
  }

  public static getSupportedLanguages(): string[] {
    return Array.from(new Set(Object.values(LANGUAGE_MAP))).sort();
  }

  public static getSupportedExtensions(): string[] {
    return Object.keys(LANGUAGE_MAP).sort();
  }
}