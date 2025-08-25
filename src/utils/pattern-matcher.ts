/**
 * Enhanced pattern matching utilities for robust code analysis
 */

export interface PatternMatch {
  pattern: string;
  weight: number;
  category: 'structural' | 'behavioral' | 'semantic' | 'signature';
}

export interface ExtractedPatterns {
  patterns: Set<string>;
  weighted: Map<string, number>;
  categories: Map<string, Set<string>>;
}

export class PatternMatcher {
  /**
   * Extract comprehensive patterns from a symbol
   */
  static extractPatterns(symbol: any, content?: string): ExtractedPatterns {
    const patterns = new Set<string>();
    const weighted = new Map<string, number>();
    const categories = new Map<string, Set<string>>();
    
    // Helper to add pattern with weight and category
    const addPattern = (pattern: string, weight: number, category: string) => {
      patterns.add(pattern);
      weighted.set(pattern, weight);
      
      if (!categories.has(category)) {
        categories.set(category, new Set());
      }
      categories.get(category)!.add(pattern);
    };
    
    // 1. Structural patterns
    addPattern(`type:${symbol.type}`, 1.5, 'structural');
    
    // Enhanced constructor detection
    if (symbol.type === 'method' && symbol.name === 'constructor') {
      addPattern('pattern:constructor', 3.0, 'structural');
      addPattern('method:constructor', 2.5, 'structural');
    }
    
    // Enhanced method patterns
    if (symbol.type === 'method' || symbol.type === 'function') {
      // Method visibility/modifiers
      const metadata = symbol.metadata || {};
      if (metadata.static) addPattern('modifier:static', 1.5, 'structural');
      if (metadata.async) addPattern('modifier:async', 1.5, 'structural');
      if (metadata.private) addPattern('modifier:private', 1.2, 'structural');
      if (metadata.protected) addPattern('modifier:protected', 1.2, 'structural');
      if (metadata.generator) addPattern('modifier:generator', 1.5, 'structural');
      
      // Method kind
      if (metadata.kind) {
        addPattern(`kind:${metadata.kind}`, 2.0, 'structural');
        
        // Special handling for getters/setters
        if (metadata.kind === 'get') addPattern('accessor:getter', 2.0, 'structural');
        if (metadata.kind === 'set') addPattern('accessor:setter', 2.0, 'structural');
      }
    }
    
    // 2. Signature patterns
    const signature = symbol.signature || content || '';
    
    // Enhanced parameter extraction
    const paramPatterns = this.extractParameterPatterns(signature);
    paramPatterns.forEach(p => addPattern(p.pattern, p.weight, 'signature'));
    
    // Enhanced return type extraction
    const returnPattern = this.extractReturnPattern(signature);
    if (returnPattern) {
      addPattern(returnPattern.pattern, returnPattern.weight, 'signature');
    }
    
    // Generic/template patterns
    const genericPatterns = this.extractGenericPatterns(signature);
    genericPatterns.forEach(p => addPattern(p.pattern, p.weight, 'signature'));
    
    // 3. Behavioral patterns
    if (content) {
      const behavioralPatterns = this.extractBehavioralPatterns(content);
      behavioralPatterns.forEach(p => addPattern(p.pattern, p.weight, 'behavioral'));
    }
    
    // 4. Semantic patterns
    const semanticPatterns = this.extractSemanticPatterns(symbol.name, signature);
    semanticPatterns.forEach(p => addPattern(p.pattern, p.weight, 'semantic'));
    
    return { patterns, weighted, categories };
  }
  
  /**
   * Extract parameter patterns with type analysis
   */
  private static extractParameterPatterns(signature: string): PatternMatch[] {
    const patterns: PatternMatch[] = [];
    
    // Match various parameter formats
    const paramRegexes = [
      /\(([^)]*)\)/,                    // Standard function params
      /constructor\s*\(([^)]*)\)/,     // Constructor params
      /\w+\s*\(([^)]*)\)/              // Method params
    ];
    
    let paramStr = '';
    for (const regex of paramRegexes) {
      const match = signature.match(regex);
      if (match && match[1]) {
        paramStr = match[1];
        break;
      }
    }
    
    if (paramStr) {
      // Parse parameters considering nested types
      const params = this.parseParameters(paramStr);
      
      patterns.push({
        pattern: `param_count:${params.length}`,
        weight: 2.0,
        category: 'signature'
      });
      
      // Analyze each parameter
      params.forEach((param, index) => {
        // Parameter type patterns
        if (param.type) {
          patterns.push({
            pattern: `param_type:${param.type}`,
            weight: 1.8,
            category: 'signature'
          });
          
          // Common type categories
          if (this.isPrimitiveType(param.type)) {
            patterns.push({
              pattern: 'param_category:primitive',
              weight: 1.2,
              category: 'signature'
            });
          }
          if (this.isCollectionType(param.type)) {
            patterns.push({
              pattern: 'param_category:collection',
              weight: 1.3,
              category: 'signature'
            });
          }
          if (this.isPromiseType(param.type)) {
            patterns.push({
              pattern: 'param_category:async',
              weight: 1.5,
              category: 'signature'
            });
          }
        }
        
        // Optional/rest parameters
        if (param.optional) {
          patterns.push({
            pattern: 'param_optional:true',
            weight: 1.2,
            category: 'signature'
          });
        }
        if (param.rest) {
          patterns.push({
            pattern: 'param_rest:true',
            weight: 1.3,
            category: 'signature'
          });
        }
        
        // Destructured parameters
        if (param.destructured) {
          patterns.push({
            pattern: 'param_destructured:true',
            weight: 1.4,
            category: 'signature'
          });
        }
      });
      
      // Parameter pattern combinations
      if (params.every(p => p.type)) {
        patterns.push({
          pattern: 'param_all_typed:true',
          weight: 1.5,
          category: 'signature'
        });
      }
    } else {
      patterns.push({
        pattern: 'param_count:0',
        weight: 2.0,
        category: 'signature'
      });
    }
    
    return patterns;
  }
  
  /**
   * Parse parameters handling complex types
   */
  private static parseParameters(paramStr: string): Array<{
    name: string;
    type?: string;
    optional?: boolean;
    rest?: boolean;
    destructured?: boolean;
  }> {
    const params: any[] = [];
    
    // Handle empty parameters
    if (!paramStr.trim()) return params;
    
    // Split by comma but respect nested structures
    const parts = this.smartSplit(paramStr, ',');
    
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      
      const param: any = {};
      
      // Check for rest parameter
      if (trimmed.startsWith('...')) {
        param.rest = true;
        const rest = trimmed.substring(3).trim();
        this.parseParamPart(rest, param);
      }
      // Check for destructuring
      else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        param.destructured = true;
        param.name = 'destructured';
        // Extract type if present
        const typeMatch = trimmed.match(/:\s*(.+)$/);
        if (typeMatch) {
          param.type = this.normalizeType(typeMatch[1]);
        }
      }
      // Regular parameter
      else {
        this.parseParamPart(trimmed, param);
      }
      
      params.push(param);
    }
    
    return params;
  }
  
  /**
   * Parse a single parameter part
   */
  private static parseParamPart(part: string, param: any): void {
    // Check for optional parameter
    if (part.includes('?')) {
      param.optional = true;
      part = part.replace('?', '');
    }
    
    // Split name and type
    const colonIndex = part.indexOf(':');
    if (colonIndex > -1) {
      param.name = part.substring(0, colonIndex).trim();
      let typeStr = part.substring(colonIndex + 1).trim();
      
      // Remove default value if present
      const equalsIndex = typeStr.indexOf('=');
      if (equalsIndex > -1) {
        typeStr = typeStr.substring(0, equalsIndex).trim();
      }
      
      param.type = this.normalizeType(typeStr);
    } else {
      // No type annotation
      param.name = part.split('=')[0].trim();
    }
  }
  
  /**
   * Smart split that respects nested structures
   */
  private static smartSplit(str: string, delimiter: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      // Handle strings
      if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== '\\')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }
      
      if (!inString) {
        // Track nesting depth
        if (char === '(' || char === '[' || char === '{' || char === '<') {
          depth++;
        } else if (char === ')' || char === ']' || char === '}' || char === '>') {
          depth--;
        }
        // Split at delimiter only at depth 0
        else if (char === delimiter && depth === 0) {
          parts.push(current);
          current = '';
          continue;
        }
      }
      
      current += char;
    }
    
    if (current) {
      parts.push(current);
    }
    
    return parts;
  }
  
  /**
   * Extract return type patterns
   */
  private static extractReturnPattern(signature: string): PatternMatch | null {
    // Match various return type formats
    const returnRegexes = [
      /\)\s*:\s*([^{=]+)(?:\s*[{=]|$)/,  // TypeScript style
      /=>\s*([^{]+)$/,                    // Arrow function
      /returns?\s+(\S+)/i                 // JSDoc style
    ];
    
    for (const regex of returnRegexes) {
      const match = signature.match(regex);
      if (match && match[1]) {
        const returnType = this.normalizeType(match[1].trim());
        
        const weight = this.isVoidType(returnType) ? 1.5 : 2.0;
        
        return {
          pattern: `return:${returnType}`,
          weight,
          category: 'signature'
        };
      }
    }
    
    return null;
  }
  
  /**
   * Extract generic/template patterns
   */
  private static extractGenericPatterns(signature: string): PatternMatch[] {
    const patterns: PatternMatch[] = [];
    
    // Match generic declarations
    const genericMatch = signature.match(/<([^>]+)>/g);
    if (genericMatch) {
      patterns.push({
        pattern: 'has_generics:true',
        weight: 1.8,
        category: 'signature'
      });
      
      genericMatch.forEach(g => {
        const generic = g.slice(1, -1).trim();
        patterns.push({
          pattern: `generic:${generic}`,
          weight: 1.5,
          category: 'signature'
        });
      });
    }
    
    return patterns;
  }
  
  /**
   * Extract behavioral patterns from code content
   */
  private static extractBehavioralPatterns(content: string): PatternMatch[] {
    const patterns: PatternMatch[] = [];
    
    // Control flow patterns
    const controlFlow = [
      { regex: /\bif\s*\(/g, pattern: 'flow:conditional', weight: 1.2 },
      { regex: /\belse\s+if\s*\(/g, pattern: 'flow:else_if', weight: 1.3 },
      { regex: /\bswitch\s*\(/g, pattern: 'flow:switch', weight: 1.4 },
      { regex: /\bfor\s*\(/g, pattern: 'flow:for_loop', weight: 1.3 },
      { regex: /\bwhile\s*\(/g, pattern: 'flow:while_loop', weight: 1.3 },
      { regex: /\.forEach\s*\(/g, pattern: 'flow:foreach', weight: 1.2 },
      { regex: /\.map\s*\(/g, pattern: 'flow:map', weight: 1.2 },
      { regex: /\.filter\s*\(/g, pattern: 'flow:filter', weight: 1.2 },
      { regex: /\.reduce\s*\(/g, pattern: 'flow:reduce', weight: 1.3 },
      { regex: /\btry\s*{/g, pattern: 'flow:try_catch', weight: 1.5 },
      { regex: /\bthrow\s+/g, pattern: 'flow:throw', weight: 1.4 },
      { regex: /\basync\s+/g, pattern: 'flow:async', weight: 1.6 },
      { regex: /\bawait\s+/g, pattern: 'flow:await', weight: 1.6 },
      { regex: /\breturn\s+/g, pattern: 'flow:return', weight: 1.1 },
      { regex: /\byield\s+/g, pattern: 'flow:yield', weight: 1.5 }
    ];
    
    controlFlow.forEach(({ regex, pattern, weight }) => {
      if (regex.test(content)) {
        patterns.push({ pattern, weight, category: 'behavioral' });
      }
    });
    
    // Pattern detection
    const codePatterns = [
      { regex: /new\s+\w+/g, pattern: 'pattern:instantiation', weight: 1.4 },
      { regex: /\.\w+\s*=/g, pattern: 'pattern:property_assignment', weight: 1.2 },
      { regex: /this\.\w+/g, pattern: 'pattern:this_usage', weight: 1.3 },
      { regex: /super\s*\(/g, pattern: 'pattern:super_call', weight: 1.5 },
      { regex: /console\.\w+/g, pattern: 'pattern:logging', weight: 1.1 },
      { regex: /localStorage|sessionStorage/g, pattern: 'pattern:storage', weight: 1.4 },
      { regex: /fetch\s*\(|axios/g, pattern: 'pattern:http', weight: 1.5 },
      { regex: /setTimeout|setInterval/g, pattern: 'pattern:timer', weight: 1.3 },
      { regex: /addEventListener/g, pattern: 'pattern:event_listener', weight: 1.4 },
      { regex: /querySelector/g, pattern: 'pattern:dom_query', weight: 1.3 },
      { regex: /import\s+/g, pattern: 'pattern:imports', weight: 1.1 },
      { regex: /export\s+/g, pattern: 'pattern:exports', weight: 1.1 }
    ];
    
    codePatterns.forEach(({ regex, pattern, weight }) => {
      if (regex.test(content)) {
        patterns.push({ pattern, weight, category: 'behavioral' });
      }
    });
    
    return patterns;
  }
  
  /**
   * Extract semantic patterns from names and signatures
   */
  private static extractSemanticPatterns(name: string, signature: string): PatternMatch[] {
    const patterns: PatternMatch[] = [];
    const lowerName = name.toLowerCase();
    
    // CRUD operations
    const crudPatterns = [
      { keywords: ['get', 'fetch', 'find', 'search', 'query', 'read', 'load'], pattern: 'crud:read' },
      { keywords: ['create', 'add', 'insert', 'new', 'post'], pattern: 'crud:create' },
      { keywords: ['update', 'modify', 'edit', 'patch', 'put', 'save'], pattern: 'crud:update' },
      { keywords: ['delete', 'remove', 'destroy', 'drop'], pattern: 'crud:delete' }
    ];
    
    crudPatterns.forEach(({ keywords, pattern }) => {
      if (keywords.some(k => lowerName.includes(k))) {
        patterns.push({ pattern, weight: 1.8, category: 'semantic' });
      }
    });
    
    // Lifecycle patterns
    const lifecyclePatterns = [
      { keywords: ['init', 'initialize', 'setup', 'constructor'], pattern: 'lifecycle:init' },
      { keywords: ['destroy', 'cleanup', 'dispose', 'unmount'], pattern: 'lifecycle:cleanup' },
      { keywords: ['mount', 'didmount', 'willmount'], pattern: 'lifecycle:mount' },
      { keywords: ['update', 'didupdate', 'willupdate'], pattern: 'lifecycle:update' },
      { keywords: ['render'], pattern: 'lifecycle:render' }
    ];
    
    lifecyclePatterns.forEach(({ keywords, pattern }) => {
      if (keywords.some(k => lowerName.includes(k))) {
        patterns.push({ pattern, weight: 1.7, category: 'semantic' });
      }
    });
    
    // Validation patterns
    if (lowerName.includes('valid') || lowerName.includes('check') || lowerName.includes('verify')) {
      patterns.push({ pattern: 'semantic:validation', weight: 1.6, category: 'semantic' });
    }
    
    // Event handler patterns
    if (lowerName.startsWith('on') || lowerName.startsWith('handle')) {
      patterns.push({ pattern: 'semantic:event_handler', weight: 1.6, category: 'semantic' });
    }
    
    // Helper/utility patterns
    if (lowerName.includes('util') || lowerName.includes('helper') || lowerName.includes('format')) {
      patterns.push({ pattern: 'semantic:utility', weight: 1.4, category: 'semantic' });
    }
    
    // Test patterns
    if (lowerName.includes('test') || lowerName.includes('spec') || lowerName.includes('mock')) {
      patterns.push({ pattern: 'semantic:test', weight: 1.3, category: 'semantic' });
    }
    
    return patterns;
  }
  
  /**
   * Calculate similarity between two pattern sets with category weighting
   */
  static calculateSimilarity(patterns1: ExtractedPatterns, patterns2: ExtractedPatterns): number {
    const weights = {
      structural: 2.0,
      signature: 1.8,
      behavioral: 1.5,
      semantic: 1.3
    };
    
    let totalWeight = 0;
    let matchedWeight = 0;
    
    // Calculate weighted similarity by category
    patterns1.categories.forEach((catPatterns, category) => {
      const categoryWeight = weights[category as keyof typeof weights] || 1.0;
      const otherCatPatterns = patterns2.categories.get(category) || new Set();
      
      catPatterns.forEach(pattern => {
        const patternWeight = patterns1.weighted.get(pattern) || 1.0;
        const weight = categoryWeight * patternWeight;
        totalWeight += weight;
        
        if (otherCatPatterns.has(pattern)) {
          matchedWeight += weight;
        }
      });
    });
    
    // Add patterns from patterns2 not in patterns1
    patterns2.categories.forEach((catPatterns, category) => {
      const categoryWeight = weights[category as keyof typeof weights] || 1.0;
      const otherCatPatterns = patterns1.categories.get(category) || new Set();
      
      catPatterns.forEach(pattern => {
        if (!otherCatPatterns.has(pattern)) {
          const patternWeight = patterns2.weighted.get(pattern) || 1.0;
          totalWeight += categoryWeight * patternWeight;
        }
      });
    });
    
    return totalWeight > 0 ? matchedWeight / totalWeight : 0;
  }
  
  // Type checking utilities
  private static normalizeType(type: string): string {
    return type
      .replace(/\s+/g, ' ')
      .replace(/\s*\|\s*/g, '|')
      .replace(/\s*&\s*/g, '&')
      .replace(/\s*,\s*/g, ',')
      .replace(/\s*<\s*/g, '<')
      .replace(/\s*>\s*/g, '>')
      .trim();
  }
  
  private static isPrimitiveType(type: string): boolean {
    const primitives = ['string', 'number', 'boolean', 'symbol', 'undefined', 'null', 'void', 'any', 'unknown'];
    return primitives.includes(type.toLowerCase());
  }
  
  private static isCollectionType(type: string): boolean {
    return /array|list|set|map|collection|\[\]/i.test(type);
  }
  
  private static isPromiseType(type: string): boolean {
    return /promise|async|observable/i.test(type);
  }
  
  private static isVoidType(type: string): boolean {
    return /void|undefined|never/i.test(type);
  }
}