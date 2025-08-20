# Primordyn

**Auto-documentation engine for AI-assisted development**

Primordyn is a command-line tool that indexes codebases and serves intelligent context to AI agents. It provides fast, token-aware context retrieval to help AI assistants better understand and navigate your code.

## Features

- 🔍 **Smart Code Indexing** - Scans and indexes codebases with language-aware parsing
- 🎯 **Intelligent Context Retrieval** - Finds relevant code based on queries and intent
- 📊 **Token-Aware** - Respects token limits for optimal AI interactions  
- 🚀 **Fast Search** - SQLite-powered indexing for instant results
- 🌍 **Multi-Language Support** - TypeScript, JavaScript, Python, Go, Rust, and more
- 📁 **Gitignore Integration** - Automatically respects your ignore patterns
- 🔄 **Incremental Updates** - Only re-indexes changed files

## Installation

```bash
npm install -g primordyn
```

## Quick Start

```bash
# Index your codebase
primordyn index

# Query for relevant context
primordyn query "authentication logic" --max-tokens 2000

# Find specific symbols
primordyn find "handleLogin" --include-content

# Get project overview
primordyn stats
```

## Commands

### `primordyn index [path]`
Index a codebase for context retrieval.

Options:
- `--languages <langs>` - Filter by languages (ts,js,py,go,rs)
- `--max-file-size <size>` - Skip files larger than size (default: 1MB)
- `--follow-symlinks` - Follow symbolic links
- `--update` - Update existing index

### `primordyn query <search-term>`
Search for relevant code context.

Options:
- `--max-tokens <tokens>` - Limit response tokens (default: 4000)
- `--include-content` - Include full file contents
- `--include-symbols` - Include symbol definitions
- `--file-types <types>` - Filter by file types
- `--sort-by <field>` - Sort by: relevance, path, size, modified

### `primordyn find <symbol-name>`
Find specific symbols (functions, classes, etc.).

Options:
- `--type <type>` - Filter by symbol type
- `--include-content` - Include symbol content
- `--max-results <num>` - Limit number of results

### `primordyn related <file-path>`
Find files related to a specific file.

Options:
- `--max-tokens <tokens>` - Limit response tokens
- `--include-content` - Include file contents

### `primordyn stats`
Display indexing statistics and project overview.

### `primordyn clear`
Clear the current index.

## Configuration

Primordyn respects `.gitignore` and supports `.primordynignore` for additional patterns:

```
# .primordynignore
*.generated.ts
temp/
build/
```

## Integration with AI Tools

Primordyn is designed to work seamlessly with AI development tools:

```bash
# Get context for an AI assistant
primordyn query "user authentication" --max-tokens 3000 --include-symbols

# Find related code for refactoring
primordyn related src/auth/login.ts --include-content

# Get project structure overview
primordyn stats
```

## License

MIT
