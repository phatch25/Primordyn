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
primordyn query "PrimordynDB"

# Show relationships and dependencies
primordyn query "ContextExtractor" --show-graph

# Include usage locations
primordyn query "FileScanner" --include-callers

# Get project overview
primordyn stats --json
```

## Commands

### `primordyn index [path]`
Build or update the local context index for AI agents.

```bash
primordyn index                    # Index current directory
primordyn index /path/to/project   # Index specific path
```

### `primordyn query <search-term>`
Smart context retrieval for AI agents - finds symbols, functions, classes, and their relationships.

```bash
# AI-optimized markdown output (default)
primordyn query "PrimordynDB"

# Show dependency relationships
primordyn query "ContextExtractor" --show-graph

# Include usage locations
primordyn query "Indexer" --include-callers

# Human-readable format for terminal
primordyn query "FileScanner" --format human

# JSON for programmatic use
primordyn query "ContextRetriever" --format json

# Filter by language
primordyn query "function" --languages typescript
```

Options:
- `--tokens <max>` - Maximum tokens in response (default: 8000)
- `--format <type>` - Output format: `ai` (markdown), `json`, `human` (default: ai)
- `--depth <n>` - Depth of context expansion (default: 1)
- `--include-tests` - Include related test files
- `--include-callers` - Include files that use this symbol
- `--show-graph` - Show dependency graph (what it calls and what calls it)
- `--recent <days>` - Show commits from last N days (default: 7)
- `--blame` - Show git blame (who last modified each line)
- `--languages <langs>` - Filter by languages: typescript,javascript,python,go,etc

### `primordyn stats`
Show index status and project overview.

```bash
primordyn stats         # Human-readable stats
primordyn stats --json  # JSON output for tools
```

### `primordyn clear`
Clear the current index database.

```bash
primordyn clear         # Clear with confirmation
primordyn clear --force  # Clear without confirmation
```

## Real-World Examples

### Understanding Code Structure

```bash
# Get complete context about a database class
primordyn query "PrimordynDB" --include-callers --show-graph

# Output includes:
# - Class implementation and signatures
# - File location (src/database/index.ts:6-178)
# - What methods it calls (dependencies)
# - What files use this class (callers)
# - Related symbols and their locations
```

### AI Development Workflow

```bash
# Exploring an unfamiliar codebase - find the main retrieval logic
primordyn query "ContextRetriever"

# Understanding relationships - see what calls what
primordyn query "FileScanner" --show-graph

# Getting focused context for AI - limit token usage
primordyn query "extract" --tokens 4000 --format ai
```

## Output Formats

### AI Format (--format ai, default)
Clean markdown optimized for AI consumption:

```markdown
# Context for: PrimordynDB

## PrimordynDB (class)
📍 src/database/index.ts:6-178

### Signature
```typescript
export class PrimordynDB
```

### Found in Files
- **src/indexer/index.ts** (2294 tokens)
- **src/commands/clear-command.ts** (292 tokens)

### Text References
- **src/commands/clear-command.ts** Lines: 11
- **src/indexer/index.ts** Lines: 10, 13

### Token Usage
- Total tokens: 4,586
```

### JSON Format (--format json)
Structured data for programmatic use:

```json
{
  "primarySymbol": {
    "name": "PrimordynDB",
    "type": "class",
    "filePath": "src/database/index.ts",
    "lineStart": 6,
    "lineEnd": 178
  },
  "files": [...],
  "usages": [...],
  "totalTokens": 4586
}
```

### Human Format (--format human)
Terminal-friendly with visual formatting and colored output.

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