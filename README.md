# Primordyn

**Smart context retrieval for AI-assisted development**

[![Version](https://img.shields.io/badge/version-0.1.0--alpha-orange)](https://github.com/phatch25/Primordyn)
[![Status](https://img.shields.io/badge/status-alpha-yellow)](https://github.com/phatch25/Primordyn)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> **Alpha Release**: This is an early developmental version (v0.1.0). APIs may change and bugs may exist. Please [report issues](https://github.com/phatch25/Primordyn/issues).

Primordyn indexes your codebase and provides intelligent context retrieval optimized for AI coding assistants. It understands code relationships and delivers precise information: implementations, dependencies, usage locations, and related files.

## Features

- **Smart Symbol Resolution** - Find any function, class, or type with full context
- **Fuzzy Search** - Typo-tolerant search that finds what you meant
- **Symbol Type Filtering** - Search for specific types (classes, interfaces, functions)
- **Usage Tracking** - See where symbols are defined and used
- **Git Integration** - View blame, history, and recent changes
- **Impact Analysis** - Understand refactoring risks before making changes
- **Precise Locations** - File:line references for easy navigation
- **AI-Optimized Output** - Clean markdown format for LLM consumption
- **Fast Search** - SQLite FTS5 for instant results
- **Smart Context Selection** - Intelligent content extraction to minimize truncation
- **Token-Aware** - Respects context limits with smart prioritization

## Installation

```bash
npm install -g primordyn@alpha
```

## Quick Start

```bash
# Index your codebase
primordyn index

# Find a symbol with full context
primordyn query "YourClassName"

# Show dependencies and relationships
primordyn query "functionName" --show-graph

# Get project statistics
primordyn stats
```

## Commands

### `primordyn index [path]`

Build or update the context index.

```bash
primordyn index                    # Index current directory
primordyn index /path/to/project   # Index specific path
```

### `primordyn query <search-term>`

Search for symbols, functions, classes, and their relationships.

```bash
# Basic search
primordyn query "DatabaseConnection"

# Show what calls it and what it calls
primordyn query "processFile" --show-graph

# Search for specific symbol types
primordyn query "Database" --type class
primordyn query "Config" --type interface

# Include all usage locations
primordyn query "Config" --include-callers

# Get impact analysis for refactoring
primordyn query "OldAPI" --impact

# View git history and blame
primordyn query "buggyFunction" --blame --recent 14

# Output as JSON for tooling
primordyn query "Parser" --format json

# Limit token count for AI context windows
primordyn query "complexFunction" --tokens 4000

# Fuzzy search handles typos automatically
primordyn query "databse"  # Will find "database"
```

**Options:**
- `--tokens <max>` - Maximum tokens in response (default: 8000)
- `--format <type>` - Output format: `ai`, `json`, `human` (default: ai)
- `--type <symbol-type>` - Filter by symbol type (e.g., class, interface, function)
- `--show-graph` - Show dependency relationships
- `--include-callers` - Include all files that use this symbol
- `--impact` - Show refactoring impact analysis
- `--languages <langs>` - Filter by language (e.g., typescript,python)
- `--blame` - Show git blame information
- `--recent <days>` - Show commits from last N days (default: 7)
- `--depth <n>` - Depth of context expansion (default: 1)

### `primordyn stats`

Display project statistics and index status.

```bash
primordyn stats         # Human-readable statistics
primordyn stats --json  # JSON output for automation
```

### `primordyn clear`

Remove the current index.

```bash
primordyn clear         # Interactive confirmation
primordyn clear --force # Skip confirmation
```

## Claude Code Integration

Primordyn is designed to enhance [Claude Code](https://docs.anthropic.com/en/docs/claude-code) workflows by providing instant, accurate context.

### Basic Workflow

Instead of having Claude search through files:

```bash
# Traditional approach
claude
> find the authentication logic in this codebase

# With Primordyn
primordyn query "auth login authenticate" --include-callers
# Copy output to Claude for precise context
```

### Practical Examples

#### Understanding a Codebase

```bash
# Get project overview
primordyn stats

# Find main entry points
primordyn query "main index app" --format ai

# Explore specific functionality
primordyn query "DatabaseConnection" --show-graph
```

#### Before Refactoring

```bash
# Check impact before making changes
primordyn query "DeprecatedAPI" --impact

# See all dependencies
primordyn query "CoreService" --show-graph --include-callers
```

#### Debugging

```bash
# Find error context
primordyn query "ErrorHandler" --show-graph

# Trace function calls
primordyn query "problematicFunction" --include-callers
```

## Output Example

```markdown
# Context for: UserService

## UserService (class)
src/services/user.ts:15-89

### Signature
```typescript
export class UserService
```

### Found in Files
- **src/controllers/auth.ts** (2150 tokens)
- **src/tests/user.test.ts** (890 tokens)

### Called By
- **AuthController.login** at src/controllers/auth.ts:34
- **AuthController.register** at src/controllers/auth.ts:67
```

## Architecture

Primordyn uses SQLite with full-text search (FTS5) for fast, efficient indexing. The index is stored in `.primordyn/context.db`.

**Key Features:**
- Incremental updates (only re-indexes changed files)
- Multi-language support
- Token counting using GPT-4 tokenizer
- AST-based symbol extraction for accuracy

## Configuration

Primordyn automatically respects `.gitignore` patterns. Add a `.primordynignore` file for additional exclusions:

```
# .primordynignore
*.generated.ts
build/
dist/
temp/
```

## Contributing

This is an alpha release. Contributions, bug reports, and feature requests are welcome at [GitHub Issues](https://github.com/phatch25/Primordyn/issues).

## License

MIT