# Primordyn

**Smart context retrieval for AI-assisted development**

Primordyn indexes your codebase and provides intelligent context retrieval optimized for AI agents like Claude, ChatGPT, and Copilot. It understands code relationships and delivers exactly what AI needs: implementations, dependencies, usage locations, and related files.

## Features

- 🎯 **Smart Symbol Resolution** - Find any function, class, or type with its full context
- 🔗 **Usage Tracking** - See where symbols are defined and where they're used
- 📍 **Precise Locations** - Always shows file:line for easy navigation
- 🤖 **AI-Optimized Output** - Clean markdown format perfect for AI consumption
- 🚀 **Fast Search** - SQLite FTS5 for instant results
- 💡 **Token-Aware** - Respects context limits with smart prioritization

## Installation

```bash
npm install -g primordyn
```

## Quick Start

```bash
# Index your codebase
primordyn index

# Query with AI-optimized output (default)
primordyn query "DatabaseConnection"

# Include usage locations
primordyn query "validateUser" --include-callers

# Get project overview
primordyn stats --json
```

## Core Commands

### `primordyn index [path]`
Index a codebase for context retrieval.

```bash
primordyn index                    # Index current directory
primordyn index /path/to/project   # Index specific path
```

### `primordyn query <term>`
Smart context retrieval that returns everything an AI needs about a symbol, function, or class.

```bash
# AI-optimized markdown output (default)
primordyn query "AuthService"

# Include where it's used
primordyn query "parseConfig" --include-callers

# Human-readable format for terminal
primordyn query "Router" --format human

# JSON for programmatic use
primordyn query "Handler" --format json --languages ts,js
```

Options:
- `--format <type>` - Output format: `ai` (markdown), `json`, `human` (default: ai)
- `--tokens <max>` - Maximum tokens in response (default: 8000)
- `--include-callers` - Show where the symbol is used
- `--include-tests` - Include related test files
- `--languages <langs>` - Filter by languages (ts,js,py,go,rs)

### `primordyn stats`
Display project overview and indexing statistics.

```bash
primordyn stats         # Human-readable stats
primordyn stats --json  # JSON output for tools
```

### `primordyn clear`
Clear the index database.

```bash
primordyn clear --force  # Clear without confirmation
```

## AI Integration Examples

### For Claude or ChatGPT

```bash
# Get full context about a class (AI format is default)
primordyn query "PrimordynDB" --include-callers

# Output includes:
# - Full implementation
# - File location with line numbers
# - Method signatures
# - Where it's imported and used
# - Related symbols
```

### For Development Workflows

```bash
# Understanding a function
primordyn query "handleRequest"

# Finding test coverage
primordyn query "UserService" --include-tests

# Tracing dependencies
primordyn query "ConfigLoader" --include-callers
```

## Output Format

The `--format ai` option provides clean markdown optimized for AI consumption:

```markdown
# Context for: DatabaseManager

## DatabaseManager (class)
📍 src/db/manager.ts:15-200

### Implementation
[Full class code]

### Used By
- src/api/users.ts (Lines: 23, 45, 67)
- src/api/posts.ts (Lines: 12, 34)
- src/tests/db.test.ts (Lines: 5, 20, 35)

### Related Symbols
- ConnectionPool (class) - src/db/pool.ts:10
- QueryBuilder (class) - src/db/query.ts:25
```

## Architecture

Primordyn uses SQLite with full-text search (FTS5) for fast, efficient indexing. The database is stored in `.primordyn/context.db` in your project root.

Key features:
- **Incremental Updates** - Only re-indexes changed files
- **Language-Aware** - Special handling for TypeScript, JavaScript, Python, Go, Rust
- **Token Counting** - Uses GPT-4 tokenizer for accurate context sizing
- **Symbol Extraction** - Parses code to understand functions, classes, types

## Configuration

Primordyn respects `.gitignore` patterns automatically. You can add additional patterns with `.primordynignore`:

```
# .primordynignore
*.generated.ts
build/
dist/
```

## License

MIT