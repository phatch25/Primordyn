# Primordyn

**Smart context retrieval for AI-assisted development**

Primordyn indexes your codebase and provides intelligent context retrieval optimized for AI agents like Claude, ChatGPT, and Copilot. It understands code relationships and delivers exactly what AI needs: implementations, dependencies, usage locations, and related files.

> 💡 **Perfect for Claude Code**: Primordyn is specifically designed to enhance [Claude Code workflows](https://docs.anthropic.com/en/docs/claude-code/common-workflows). Jump to [Claude Code Integration](#claude-code-integration) to see how it supercharges your AI pair programming sessions.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Claude Code Integration](#claude-code-integration) ⭐
  - [Enhanced Workflows](#-enhanced-claude-code-workflows)
  - [Recipes](#-claude-code--primordyn-recipes)
  - [Pro Tips](#-pro-tips-for-claude-code--primordyn)
- [Commands](#commands)
- [Output Formats](#output-formats)
- [Architecture](#architecture)
- [Configuration](#configuration)

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

## Claude Code Integration

Primordyn supercharges [Claude Code workflows](https://docs.anthropic.com/en/docs/claude-code/common-workflows) by providing precise, context-aware code intelligence. Here's how to integrate Primordyn into your Claude Code sessions for maximum effectiveness.

### 🚀 Enhanced Claude Code Workflows

#### 1. **Understanding New Codebases** - Supercharged with Primordyn

Instead of asking Claude to explore blindly:
```bash
# Traditional approach (Claude searches through everything)
claude
> give me an overview of this codebase

# With Primordyn (instant, structured insights)
primordyn index                           # One-time setup
primordyn stats --json | claude           # Feed project stats to Claude
primordyn query "main entry" | claude     # Show Claude the entry points
```

**Power Workflow:**
```bash
# Get comprehensive codebase overview for Claude
claude
> I've indexed this codebase with Primordyn. Here's what I found:
> $(primordyn stats)
> The main entry points are: $(primordyn query "main" --format ai)
> Now, what specific area would you like to explore?
```

#### 2. **Finding Relevant Code** - Precision Search

```bash
# Traditional (Claude searches manually)
> find the files that handle user authentication

# With Primordyn (instant, accurate results)
> $(primordyn query "auth login session" --include-callers)
> These are all the authentication-related symbols and their usages
```

**Advanced Pattern:**
```bash
# Find implementation AND all places it's used
primordyn query "authenticate" --show-graph --include-callers | claude
> I found the authentication logic. Here's the complete context including 
> what calls it and what it depends on. How should we modify it?
```

#### 3. **Fixing Bugs** - Complete Context

```bash
# Provide Claude with full error context
npm test 2>&1 | tee test-output.txt
primordyn query "$(grep -o 'at \w\+' test-output.txt | head -1 | cut -d' ' -f2)" --show-graph | claude
> Here's the failing test and all related code context. The error is: $(cat test-output.txt)
```

#### 4. **Refactoring Code** - Impact Analysis

```bash
# Before refactoring, understand the impact
primordyn query "OldClassName" --impact | claude
> I want to refactor OldClassName. Here's the complete impact analysis 
> showing all 23 files that will be affected. Please proceed carefully.
```

#### 5. **Extended Thinking** - Deep Analysis with Context

When you need Claude to think deeply:
```bash
# Provide comprehensive context for extended thinking
primordyn query "SecurityManager" --show-graph --include-callers --tokens 16000 | claude
> think harder about potential security vulnerabilities in this complete 
> SecurityManager context, including all its dependencies and callers
```

#### 6. **Working with Images & Designs**

```bash
# Analyze UI component and find related code
claude
> [paste screenshot of UI component]
> $(primordyn query "Button Modal Dialog" --languages typescript jsx)
> Find the React component that matches this design
```

#### 7. **Resuming Conversations** - Persistent Context

```bash
# Save important context for resumption
primordyn query "current_feature" --format json > .claude-context.json

# Later, resume with context
claude --resume
> Continue implementing the feature. Context: $(cat .claude-context.json)
```

#### 8. **Parallel Development** - Git Worktrees

```bash
# Set up parallel Claude sessions with different contexts
git worktree add ../feature-a feature-a
cd ../feature-a
primordyn index
claude
> Focus on feature A. Context: $(primordyn query "FeatureA" --show-graph)

# In another terminal
git worktree add ../bugfix bugfix-branch  
cd ../bugfix
primordyn index
claude --continue
> Fix the bug in: $(primordyn query "BuggyFunction" --impact)
```

### 📋 Claude Code + Primordyn Recipes

#### Recipe: Complete Feature Implementation
```bash
# 1. Index the codebase
primordyn index

# 2. Find related existing code
primordyn query "similar_feature" --show-graph > context.md

# 3. Start Claude with context
claude
> I need to implement a new feature similar to what's in context.md
> $(cat context.md)
> Please follow the same patterns and conventions
```

#### Recipe: Code Review Preparation
```bash
# Get all changes with context
git diff main..HEAD --name-only | xargs -I {} primordyn query {} --format ai | claude
> Review these changes with full context of affected symbols
```

#### Recipe: Debugging Session
```bash
# Capture error and find all related code
./run-app.sh 2>&1 | tee error.log
ERROR_FUNCTION=$(grep -o "at \w\+" error.log | head -1 | awk '{print $2}')
primordyn query "$ERROR_FUNCTION" --show-graph --include-callers | claude
> Debug this error with complete function context: $(cat error.log)
```

#### Recipe: Architecture Documentation
```bash
# Generate comprehensive architecture docs
for component in "Controller" "Service" "Repository" "Model"; do
  primordyn query "$component" --format ai >> architecture.md
done
claude
> Generate architecture documentation from: $(cat architecture.md)
```

### 🎯 Pro Tips for Claude Code + Primordyn

1. **Pre-index for Speed**: Run `primordyn index` before starting Claude sessions
2. **Use Token Limits**: Use `--tokens` flag to stay within Claude's context window
3. **Chain Commands**: Pipe Primordyn output directly to Claude with `|`
4. **Save Context**: Export important queries to JSON for session resumption
5. **Impact First**: Always check `--impact` before major refactoring
6. **Graph Everything**: Use `--show-graph` to give Claude relationship context

### 💡 Advanced Integration

#### Shell Helpers
Create a `.claude-helpers` file in your project:
```bash
#!/bin/bash
# .claude-helpers

# Quick context function
context() {
  primordyn query "$1" --show-graph --include-callers --format ai
}

# Impact analysis
impact() {
  primordyn query "$1" --impact
}

# Find all related tests
tests() {
  primordyn query "$1" --include-tests --format ai
}

# Source in Claude sessions
source .claude-helpers
```

Then in Claude:
```bash
claude
> source .claude-helpers
> $(context "MainClass")    # Instant comprehensive context
> $(impact "refactor_this")  # See what will break
> $(tests "MyFunction")      # Find all related tests
```

#### Auto-indexing with Git Hooks
Keep your index always up-to-date:
```bash
# .git/hooks/post-commit
#!/bin/bash
primordyn index --update

# .git/hooks/post-checkout  
#!/bin/bash
primordyn index --update
```

#### CLAUDE.md Integration
Add Primordyn commands to your `CLAUDE.md` file so Claude automatically knows to use them:
```markdown
# CLAUDE.md

## Available Tools
This project uses Primordyn for code intelligence. Always use these commands:

- `primordyn query "symbol"` - Find any symbol with full context
- `primordyn query "symbol" --show-graph` - Show dependencies
- `primordyn query "symbol" --impact` - Show refactoring impact
- `primordyn stats` - Get project overview

## Before Making Changes
1. Always run `primordyn query "symbol" --impact` before refactoring
2. Use `primordyn query "related_code" --show-graph` to understand dependencies
3. Find tests with `primordyn query "function" --include-tests`
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