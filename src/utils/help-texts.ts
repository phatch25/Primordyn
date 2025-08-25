import chalk from 'chalk';

/**
 * Centralized help text definitions for all commands
 */

export const helpTexts = {
  graph: `
${chalk.bold('Details:')}
  The graph command visualizes dependency relationships between symbols,
  showing what a symbol calls and what calls it in a tree structure.

${chalk.bold('Features:')}
  • Bidirectional analysis - Shows both dependencies and dependents
  • Multiple formats - ASCII tree, DOT graph, or Mermaid diagram
  • Circular detection - Identifies and highlights circular dependencies
  • Depth control - Limit traversal depth to manage complexity
  • Layout options - Tree or flat (breadth-first) visualization
  • Rich metadata - Shows file locations, signatures, and call counts

${chalk.bold('Examples:')}
  ${chalk.gray('# Show dependency graph for a class')}
  $ primordyn graph UserService
  
  ${chalk.gray('# Show what depends on this symbol')}
  $ primordyn graph Logger --reverse
  
  ${chalk.gray('# Export as DOT graph for Graphviz')}
  $ primordyn graph UserService --format dot > graph.dot
  
  ${chalk.gray('# Generate Mermaid diagram')}
  $ primordyn graph UserService --format mermaid
  
  ${chalk.gray('# Show with file locations')}
  $ primordyn graph UserService --show-files
  
  ${chalk.gray('# Include function signatures')}
  $ primordyn graph UserService --show-signatures
  
  ${chalk.gray('# Limit depth to 2 levels')}
  $ primordyn graph UserService --depth 2
  
  ${chalk.gray('# Use flat layout for better overview')}
  $ primordyn graph UserService --layout flat

${chalk.bold('Visualization Symbols:')}
  • ${chalk.cyan('◆')} Class
  • ${chalk.blue('◇')} Interface
  • ${chalk.green('𝑓')} Function
  • ${chalk.green('𝑚')} Method
  • ${chalk.magenta('𝑣')} Variable
  • ${chalk.red('⟲')} Circular dependency

${chalk.bold('Notes:')}
  • Use --reverse to find what depends on your symbol
  • DOT format can be rendered with Graphviz tools
  • Mermaid format works with GitHub/GitLab markdown
  • Circular dependencies are highlighted in red`,

  unused: `
${chalk.bold('Details:')}
  The unused command identifies potentially dead code by finding symbols
  that are never referenced elsewhere in the codebase.

${chalk.bold('Features:')}
  • Smart filtering - Excludes common false positives automatically
  • Documentation exclusion - Ignores docs, examples, and config files
  • Customizable patterns - Add your own exclusion patterns
  • Export detection - Identifies exported but unused symbols
  • Size analysis - Highlights large unused code blocks
  • Multiple formats - Text, JSON, or Markdown reports

${chalk.bold('Examples:')}
  ${chalk.gray('# Find all unused symbols')}
  $ primordyn unused
  
  ${chalk.gray('# Find unused functions only')}
  $ primordyn unused --type function
  
  ${chalk.gray('# Show only large unused blocks (20+ lines)')}
  $ primordyn unused --min-lines 20
  
  ${chalk.gray('# Include test files in analysis')}
  $ primordyn unused --include-tests
  
  ${chalk.gray('# Strict mode (fewer exclusions)')}
  $ primordyn unused --strict
  
  ${chalk.gray('# Exclude custom patterns')}
  $ primordyn unused --ignore "mock" "stub" "deprecated"
  
  ${chalk.gray('# Generate markdown report')}
  $ primordyn unused --format markdown > unused-report.md
  
  ${chalk.gray('# Get JSON for processing')}
  $ primordyn unused --format json | jq '.symbols'

${chalk.bold('Default Exclusions:')}
  • Test files (*test*, *spec*)
  • Documentation (*.md, README, docs/)
  • Examples and demos
  • Configuration files
  • Private symbols (_prefixed)
  • Common entry points (main, index, app)

${chalk.bold('Notes:')}
  • Use --strict for comprehensive detection
  • Check exported symbols - they might be public API
  • Consider dynamic imports and reflection
  • Large unused blocks are highest priority`,

  patterns: `
${chalk.bold('Details:')}
  The patterns command finds code with similar structure and patterns,
  helping identify duplication and refactoring opportunities.

${chalk.bold('Features:')}
  • Multi-category analysis - Structural, signature, behavioral, semantic
  • Pattern filtering - Search for specific patterns like "constructor"
  • Weighted similarity - More important patterns have higher weight
  • Refactoring insights - Identifies consolidation opportunities
  • Category focus - Analyze specific pattern types
  • Verbose analysis - Detailed pattern breakdowns

${chalk.bold('Examples:')}
  ${chalk.gray('# Find similar code to UserService')}
  $ primordyn patterns UserService
  
  ${chalk.gray('# Find all constructors')}
  $ primordyn patterns MyClass --pattern constructor
  
  ${chalk.gray('# Find async patterns')}
  $ primordyn patterns fetchData --pattern async
  
  ${chalk.gray('# Find CRUD operations')}
  $ primordyn patterns UserController --pattern "crud:*"
  
  ${chalk.gray('# Focus on signature patterns')}
  $ primordyn patterns calculate --category signature
  
  ${chalk.gray('# Lower threshold for more matches')}
  $ primordyn patterns validate --threshold 0.4
  
  ${chalk.gray('# Show pattern details')}
  $ primordyn patterns UserService --show-patterns
  
  ${chalk.gray('# Verbose analysis')}
  $ primordyn patterns UserService --verbose

${chalk.bold('Pattern Categories:')}
  • ${chalk.cyan('Structural')} - Types, modifiers, method kinds
  • ${chalk.blue('Signature')} - Parameters, return types, generics
  • ${chalk.green('Behavioral')} - Control flow, async, error handling
  • ${chalk.yellow('Semantic')} - CRUD, lifecycle, validation, events

${chalk.bold('Notes:')}
  • Threshold 0.6 (default) = 60% similarity
  • High similarity (>80%) indicates duplication
  • Consider extracting common patterns to utilities
  • Use --pattern to find specific code patterns`,

  impact: `
${chalk.bold('Details:')}
  The impact command analyzes what would be affected if you change a symbol,
  helping assess refactoring risks and understand code dependencies.

${chalk.bold('Features:')}
  • Risk assessment - Low, Medium, High, Critical ratings
  • Test detection - Identifies affected test files
  • File analysis - Shows which files reference the symbol
  • Cascading effects - Tracks indirect dependencies
  • Export analysis - Checks if symbol is part of public API
  • Detailed metrics - Reference counts and dependency depth

${chalk.bold('Examples:')}
  ${chalk.gray('# Analyze impact of changing UserService')}
  $ primordyn impact UserService
  
  ${chalk.gray('# Check impact on a specific method')}
  $ primordyn impact "Database.connect"
  
  ${chalk.gray('# Include indirect dependencies')}
  $ primordyn impact Logger --depth 3
  
  ${chalk.gray('# Get JSON output for tools')}
  $ primordyn impact AuthService --format json
  
  ${chalk.gray('# Show detailed file list')}
  $ primordyn impact UserService --show-files

${chalk.bold('Risk Levels:')}
  • ${chalk.green('Low')} - Few references, mostly internal
  • ${chalk.yellow('Medium')} - Multiple references, some tests
  • ${chalk.red('High')} - Many references, critical paths
  • ${chalk.red.bold('Critical')} - Core functionality, exported API

${chalk.bold('Notes:')}
  • High-risk changes need careful testing
  • Check if symbol is exported (public API)
  • Consider affected test coverage
  • Use for refactoring planning`,

  list: `
${chalk.bold('Details:')}
  The list command provides fuzzy search and discovery across your codebase,
  perfect for finding symbols when you don't know the exact name.

${chalk.bold('Features:')}
  • Fuzzy matching - Finds partial and similar matches
  • Type filtering - Search specific symbol types
  • Language filtering - Limit to certain file types
  • Pattern support - Use wildcards and regex
  • Grouped output - Organized by file for readability
  • Export listing - Find all exported symbols

${chalk.bold('Examples:')}
  ${chalk.gray('# Search for anything with "user"')}
  $ primordyn list user
  
  ${chalk.gray('# List all classes')}
  $ primordyn list --type class
  
  ${chalk.gray('# Find all async functions')}
  $ primordyn list async --type function
  
  ${chalk.gray('# Search in TypeScript files only')}
  $ primordyn list auth --languages ts
  
  ${chalk.gray('# List all exported symbols')}
  $ primordyn list --exported
  
  ${chalk.gray('# Use wildcards')}
  $ primordyn list "get*User"
  
  ${chalk.gray('# Limit results')}
  $ primordyn list service --limit 20
  
  ${chalk.gray('# Get JSON output')}
  $ primordyn list user --format json

${chalk.bold('Symbol Types:')}
  • function, method
  • class, interface
  • variable, const
  • type, enum
  • export, import

${chalk.bold('Notes:')}
  • Use for discovery before using 'query'
  • Supports partial matching
  • Results ranked by relevance
  • Case-insensitive by default`,

  stats: `
${chalk.bold('Details:')}
  The stats command provides comprehensive statistics about your indexed
  codebase, including size, complexity, and language distribution.

${chalk.bold('Features:')}
  • File metrics - Count, size, token distribution
  • Symbol breakdown - Types and counts
  • Language analysis - Distribution and percentages
  • Database info - Index size and last update
  • Token statistics - For AI context planning
  • JSON export - For tracking and reporting

${chalk.bold('Examples:')}
  ${chalk.gray('# Show statistics')}
  $ primordyn stats
  
  ${chalk.gray('# Get detailed breakdown')}
  $ primordyn stats --detailed
  
  ${chalk.gray('# Output as JSON')}
  $ primordyn stats --json
  
  ${chalk.gray('# Export for tracking')}
  $ primordyn stats --json > stats.json

${chalk.bold('Metrics Included:')}
  • Total files and symbols
  • Lines of code
  • Token count (AI context size)
  • Language distribution
  • Symbol type breakdown
  • Average file size
  • Database size
  • Last index update

${chalk.bold('Notes:')}
  • Use to monitor codebase growth
  • Token count helps with AI context limits
  • Compare stats over time with JSON export`,

  duplicates: `
${chalk.bold('Details:')}
  The duplicates command finds similar or identical code blocks across your
  codebase, helping identify refactoring opportunities.

${chalk.bold('Features:')}
  • Similarity detection - Exact and near duplicates
  • Size filtering - Focus on significant duplications
  • Type-specific - Search duplicates of specific symbol types
  • Cross-file analysis - Find duplicates across files
  • Consolidation hints - Suggests where to extract common code
  • Token-based comparison - Accurate similarity measurement

${chalk.bold('Examples:')}
  ${chalk.gray('# Find all duplicate code')}
  $ primordyn duplicates
  
  ${chalk.gray('# Find large duplicates (20+ lines)')}
  $ primordyn duplicates --min-lines 20
  
  ${chalk.gray('# Find duplicate functions only')}
  $ primordyn duplicates --type function
  
  ${chalk.gray('# Set similarity threshold (90%)')}
  $ primordyn duplicates --threshold 0.9
  
  ${chalk.gray('# Show actual code blocks')}
  $ primordyn duplicates --show-code
  
  ${chalk.gray('# Get JSON report')}
  $ primordyn duplicates --format json

${chalk.bold('Similarity Levels:')}
  • ${chalk.red('100%')} - Exact duplicates
  • ${chalk.yellow('90-99%')} - Near duplicates (formatting/naming)
  • ${chalk.blue('80-89%')} - Similar structure
  • ${chalk.gray('70-79%')} - Partial similarity

${chalk.bold('Notes:')}
  • High similarity suggests extraction opportunity
  • Check if duplication is intentional
  • Consider creating shared utilities
  • Large blocks have higher impact`,

  circular: `
${chalk.bold('Details:')}
  The circular command detects circular dependencies in your codebase,
  helping maintain clean architecture and prevent dependency cycles.

${chalk.bold('Features:')}
  • Cycle detection - Finds all circular dependency chains
  • Path visualization - Shows the complete cycle
  • Severity assessment - Rates impact of each cycle
  • Module-level analysis - Detects file and package cycles
  • Breaking hints - Suggests how to break cycles
  • Depth control - Limit search depth

${chalk.bold('Examples:')}
  ${chalk.gray('# Detect all circular dependencies')}
  $ primordyn circular
  
  ${chalk.gray('# Check specific module')}
  $ primordyn circular --module src/services
  
  ${chalk.gray('# Limit to direct cycles')}
  $ primordyn circular --max-depth 2
  
  ${chalk.gray('# Show detailed paths')}
  $ primordyn circular --show-paths
  
  ${chalk.gray('# Get JSON output')}
  $ primordyn circular --format json

${chalk.bold('Cycle Types:')}
  • ${chalk.red('Direct')} - A → B → A
  • ${chalk.yellow('Indirect')} - A → B → C → A
  • ${chalk.blue('Complex')} - Multiple intertwined cycles

${chalk.bold('Breaking Strategies:')}
  • Extract interface/protocol
  • Use dependency injection
  • Create mediator/event bus
  • Restructure module boundaries

${chalk.bold('Notes:')}
  • Circular dependencies complicate testing
  • Can cause initialization issues
  • Makes refactoring difficult
  • Consider using interfaces to break cycles`,

  endpoints: `
${chalk.bold('Details:')}
  The endpoints command discovers and lists all API endpoints in your codebase,
  useful for documentation and API inventory.

${chalk.bold('Features:')}
  • Framework detection - Express, Fastify, Next.js, etc.
  • Method identification - GET, POST, PUT, DELETE, etc.
  • Route extraction - Full path patterns
  • Handler mapping - Links routes to implementations
  • Middleware detection - Identifies auth, validation
  • OpenAPI hints - Helps generate API documentation

${chalk.bold('Examples:')}
  ${chalk.gray('# List all endpoints')}
  $ primordyn endpoints
  
  ${chalk.gray('# Filter by HTTP method')}
  $ primordyn endpoints --method GET
  
  ${chalk.gray('# Filter by path pattern')}
  $ primordyn endpoints --path "/api/*"
  
  ${chalk.gray('# Show with handlers')}
  $ primordyn endpoints --show-handlers
  
  ${chalk.gray('# Get JSON for documentation')}
  $ primordyn endpoints --format json

${chalk.bold('Detected Patterns:')}
  • Express: app.get(), router.post()
  • Fastify: fastify.route()
  • Next.js: API routes
  • NestJS: @Get(), @Post() decorators
  • Custom REST patterns

${chalk.bold('Notes:')}
  • Useful for API documentation
  • Helps identify missing endpoints
  • Check for consistent naming
  • Verify authentication on endpoints`,

  alias: `
${chalk.bold('Details:')}
  The alias command manages search aliases, allowing you to create shortcuts
  for frequently used complex queries.

${chalk.bold('Features:')}
  • Create shortcuts - Save complex queries as simple names
  • Parameter support - Use placeholders in aliases
  • List management - View, update, delete aliases
  • Export/Import - Share aliases across projects
  • Built-in aliases - Common patterns pre-configured

${chalk.bold('Examples:')}
  ${chalk.gray('# Create an alias')}
  $ primordyn alias auth "UserService AuthService LoginController"
  
  ${chalk.gray('# Use an alias')}
  $ primordyn query @auth
  
  ${chalk.gray('# Create parameterized alias')}
  $ primordyn alias find-class "list --type class {0}"
  
  ${chalk.gray('# Use with parameter')}
  $ primordyn @find-class User
  
  ${chalk.gray('# List all aliases')}
  $ primordyn alias --list
  
  ${chalk.gray('# Delete an alias')}
  $ primordyn alias --delete auth
  
  ${chalk.gray('# Export aliases')}
  $ primordyn alias --export > aliases.json

${chalk.bold('Built-in Aliases:')}
  • @tests - All test files
  • @exports - Exported symbols
  • @recent - Recently modified

${chalk.bold('Notes:')}
  • Aliases start with @ when used
  • Stored in .primordyn/aliases.json
  • Can include command options
  • Great for team standardization`,

  clear: `
${chalk.bold('Details:')}
  The clear command removes the current index database, useful for
  troubleshooting or forcing a complete rebuild.

${chalk.bold('Examples:')}
  ${chalk.gray('# Clear the index')}
  $ primordyn clear
  
  ${chalk.gray('# Clear and rebuild immediately')}
  $ primordyn clear && primordyn index
  
  ${chalk.gray('# Force clear without confirmation')}
  $ primordyn clear --force

${chalk.bold('Notes:')}
  • Removes .primordyn/context.db
  • Next index will be a full rebuild
  • Use when index seems corrupted
  • Aliases are preserved`
};

/**
 * Get help text for a specific command
 */
export function getHelpText(command: string): string {
  return helpTexts[command as keyof typeof helpTexts] || '';
}