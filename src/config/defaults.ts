/**
 * Smart defaults for Primordyn commands
 * Following KISS principle - make commands work well out of the box
 */

export const DEFAULT_CONFIG = {
  // Query command defaults
  query: {
    maxTokens: 16000,        // Works for most AI models
    format: 'ai',            // AI-friendly by default
    depth: 1,                // Keep it focused
    includeTests: false,     // Reduce noise
    includeCallers: false,   // Only when needed
    showGraph: false,        // Explicit opt-in
    impact: false,           // Explicit opt-in
    fuzzyMatch: true,        // Always be helpful
  },
  
  // Unused command defaults - aggressive filtering to reduce false positives
  unused: {
    ignoreTests: true,       // Always skip test files
    ignoreDocs: true,        // Always skip documentation
    ignoreExamples: true,    // Always skip examples
    ignoreConfig: true,      // Always skip config files
    ignoreExported: true,    // Exported = potentially used externally
    minLines: 10,            // Focus on significant code blocks
    strict: false,           // Reduce false positives
    format: 'text',
    // Auto-exclude common patterns that are false positives
    autoExclude: [
      'BaseCommand',         // Abstract base classes
      'interface',           // Type definitions
      'type ',              // Type aliases
      'constructor',         // Called with new
      'Abstract',           // Abstract classes
      'I[A-Z]',             // Interface naming convention
      'Test',               // Test utilities
      'Mock',               // Test mocks
      'Stub',               // Test stubs
      'index',              // Entry points
      'main',               // Entry points
      'app',                // Entry points
    ]
  },
  
  // Index command defaults
  index: {
    incremental: true,       // Smart updates only
    showProgress: true,      // Visual feedback
    verbose: false,          // Keep it quiet
    // Auto-detect all supported languages
    languages: ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'jsx', 'tsx'],
  },
  
  // List command defaults
  list: {
    fuzzy: true,            // Always helpful
    limit: 20,              // Don't overwhelm
    sortBy: 'relevance',    // Most useful first
  },
  
  // Stats command defaults
  stats: {
    format: 'human',        // Readable by default
    detailed: false,        // Summary is usually enough
  },
  
  // Duplicates command defaults
  duplicates: {
    minLines: 10,           // Focus on significant duplication
    ignoreTests: true,      // Test code often has valid duplication
    format: 'text',
    limit: 20,              // Don't overwhelm with results
  },
  
  // Impact command defaults
  impact: {
    depth: 3,               // Reasonable depth for impact analysis
    format: 'ai',           // AI-friendly output
    includeTests: true,     // Tests ARE important for impact
  },
  
  // Graph command defaults
  graph: {
    depth: 2,               // Not too deep
    format: 'tree',         // Visual by default
    bidirectional: true,    // Show both directions
  }
};

/**
 * Get default options for a command, merging with user options
 */
export function withDefaults<T extends Record<string, any>>(
  command: keyof typeof DEFAULT_CONFIG,
  userOptions: Partial<T>
): T {
  const defaults = DEFAULT_CONFIG[command] || {};
  return { ...defaults, ...userOptions } as unknown as T;
}

/**
 * Check if a symbol should be auto-excluded based on patterns
 */
export function shouldAutoExclude(symbolName: string, symbolType: string): boolean {
  const patterns = DEFAULT_CONFIG.unused.autoExclude;
  
  for (const pattern of patterns) {
    if (pattern.includes('[')) {
      // Regex pattern
      const regex = new RegExp(pattern);
      if (regex.test(symbolName)) return true;
    } else {
      // Simple string match
      if (symbolName.includes(pattern)) return true;
      if (symbolType === pattern) return true;
    }
  }
  
  return false;
}

/**
 * Get a helpful message about defaults
 */
export function getDefaultsMessage(command: string): string {
  const defaults = DEFAULT_CONFIG[command as keyof typeof DEFAULT_CONFIG];
  if (!defaults) return '';
  
  const items = Object.entries(defaults)
    .filter(([_, value]) => typeof value !== 'object')
    .map(([key, value]) => `  • ${key}: ${value}`)
    .join('\n');
    
  return `Smart defaults applied:\n${items}`;
}