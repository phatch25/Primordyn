import type { Symbol } from '../types/index.js';

export interface EndpointPattern {
  pattern: RegExp;
  type: 'decorator' | 'method' | 'function';
  framework: string;
}

/**
 * Specialized detector for API endpoints across different frameworks
 */
export class EndpointDetector {
  private patterns: EndpointPattern[] = [
    // FastAPI (Python)
    { pattern: /@app\.(get|post|put|delete|patch|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/gi, type: 'decorator', framework: 'fastapi' },
    { pattern: /@router\.(get|post|put|delete|patch|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/gi, type: 'decorator', framework: 'fastapi' },
    
    // Flask (Python)
    { pattern: /@app\.route\s*\(\s*["'`]([^"'`]+)["'`].*methods\s*=\s*\[["'`](GET|POST|PUT|DELETE|PATCH)["'`]\]/gi, type: 'decorator', framework: 'flask' },
    { pattern: /@app\.route\s*\(\s*["'`]([^"'`]+)["'`]/gi, type: 'decorator', framework: 'flask' },
    
    // Express.js (JavaScript/TypeScript)
    { pattern: /app\.(get|post|put|delete|patch|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/gi, type: 'method', framework: 'express' },
    { pattern: /router\.(get|post|put|delete|patch|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/gi, type: 'method', framework: 'express' },
    
    // NestJS (TypeScript)
    { pattern: /@(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi, type: 'decorator', framework: 'nestjs' },
    { pattern: /@(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*\)/gi, type: 'decorator', framework: 'nestjs' },
    { pattern: /@Controller\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi, type: 'decorator', framework: 'nestjs' },
    
    // Spring Boot (Java/Kotlin)
    { pattern: /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi, type: 'decorator', framework: 'spring' },
    { pattern: /@RequestMapping\s*\(.*path\s*=\s*["'`]([^"'`]+)["'`]/gi, type: 'decorator', framework: 'spring' },
    
    // Django (Python)
    { pattern: /path\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*(\w+)/gi, type: 'function', framework: 'django' },
    { pattern: /url\s*\(\s*r?["'`]([^"'`]+)["'`]\s*,\s*(\w+)/gi, type: 'function', framework: 'django' },
    
    // Ruby on Rails
    { pattern: /(get|post|put|delete|patch)\s+["'`]([^"'`]+)["'`]/gi, type: 'method', framework: 'rails' },
    
    // ASP.NET Core (C#)
    { pattern: /\[Http(Get|Post|Put|Delete|Patch)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\]/gi, type: 'decorator', framework: 'aspnet' },
    { pattern: /\[Route\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\]/gi, type: 'decorator', framework: 'aspnet' },
    
    // Gin (Go)
    { pattern: /router\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*["'`]([^"'`]+)["'`]/gi, type: 'method', framework: 'gin' },
    { pattern: /r\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*["'`]([^"'`]+)["'`]/gi, type: 'method', framework: 'gin' },
    
    // Actix-web (Rust)
    { pattern: /#\[get\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\]/gi, type: 'decorator', framework: 'actix' },
    { pattern: /#\[post\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\]/gi, type: 'decorator', framework: 'actix' },
    { pattern: /#\[put\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\]/gi, type: 'decorator', framework: 'actix' },
    { pattern: /#\[delete\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\]/gi, type: 'decorator', framework: 'actix' },
  ];

  /**
   * Detect endpoints in file content
   */
  public detectEndpoints(content: string, filePath: string): Symbol[] {
    const endpoints: Symbol[] = [];
    const lines = content.split('\n');
    
    for (const pattern of this.patterns) {
      let match;
      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      
      while ((match = regex.exec(content)) !== null) {
        const fullMatch = match[0];
        const method = match[1] || 'GET';
        const path = match[2] || match[1] || '/';
        
        // Find line number
        const position = match.index;
        let lineNumber = 1;
        let charCount = 0;
        
        for (let i = 0; i < lines.length; i++) {
          charCount += lines[i].length + 1; // +1 for newline
          if (charCount > position) {
            lineNumber = i + 1;
            break;
          }
        }
        
        // Find the function/method name associated with this endpoint
        const functionName = this.extractFunctionName(content, position, pattern.type);
        
        endpoints.push({
          name: functionName || `${method.toUpperCase()} ${path}`,
          type: 'endpoint',
          lineStart: lineNumber,
          lineEnd: lineNumber,
          signature: `${method.toUpperCase()} ${path}`,
          metadata: {
            framework: pattern.framework,
            method: method.toUpperCase(),
            path,
            endpointType: pattern.type,
            matchedPattern: fullMatch
          }
        });
      }
    }
    
    return this.deduplicateEndpoints(endpoints);
  }
  
  /**
   * Extract the function name associated with an endpoint
   */
  private extractFunctionName(content: string, position: number, type: string): string | null {
    const afterContent = content.substring(position);
    
    if (type === 'decorator') {
      // Look for the function definition after the decorator
      const funcMatch = afterContent.match(/^\s*(?:async\s+)?(?:def|function|public|private|protected|async)?\s*(\w+)/m);
      return funcMatch ? funcMatch[1] : null;
    } else if (type === 'method') {
      // Look for the callback function
      const callbackMatch = afterContent.match(/,\s*(?:async\s+)?(?:function\s*)?(\w+)|\(\s*(?:async\s+)?(?:function\s*)?(\w+)/);
      if (callbackMatch) {
        return callbackMatch[1] || callbackMatch[2];
      }
      
      // Arrow function
      const arrowMatch = afterContent.match(/,\s*(?:async\s+)?\(\s*[^)]*\)\s*=>/);
      if (arrowMatch) {
        return 'anonymous';
      }
    }
    
    return null;
  }
  
  /**
   * Remove duplicate endpoints
   */
  private deduplicateEndpoints(endpoints: Symbol[]): Symbol[] {
    const seen = new Set<string>();
    return endpoints.filter(endpoint => {
      const key = `${endpoint.lineStart}:${endpoint.name}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  
  /**
   * Check if a symbol might be an endpoint based on its name or content
   */
  public isLikelyEndpoint(symbol: Symbol): boolean {
    const name = symbol.name.toLowerCase();
    const signature = (symbol.signature || '').toLowerCase();
    
    // Check for common endpoint patterns in name
    const endpointNamePatterns = [
      /^(get|post|put|delete|patch|head|options)/,
      /handler$/,
      /controller$/,
      /route$/,
      /endpoint$/,
      /api/
    ];
    
    if (endpointNamePatterns.some(pattern => pattern.test(name))) {
      return true;
    }
    
    // Check for endpoint patterns in signature
    const endpointContentPatterns = [
      /app\.(get|post|put|delete|patch)/,
      /router\.(get|post|put|delete|patch)/,
      /@(get|post|put|delete|patch)mapping/i,
      /@route/,
      /path\s*\(/,
      /url\s*\(/
    ];
    
    return endpointContentPatterns.some(pattern => pattern.test(signature));
  }
}