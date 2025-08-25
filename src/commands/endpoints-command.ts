import { Command } from 'commander';
import { DatabaseConnectionPool } from '../database/connection-pool.js';
import { validateSearchTerm, ValidationError } from '../utils/validation.js';
import chalk from 'chalk';
import { getHelpText } from '../utils/help-texts.js';

interface EndpointInfo {
  method: string;
  path: string;
  handler: string;
  file: string;
  line: number;
}

export const endpointsCommand = new Command('endpoints')
  .description('List all API endpoints in the codebase')
  .argument('[search-term]', 'Optional search term to filter endpoints')
  .option('--format <type>', 'Output format: ai, json, human (default: ai)', 'ai')
  .option('--group-by <type>', 'Group by: file, method, path (default: file)', 'file')
  .addHelpText('after', getHelpText('endpoints'))
  .action(async (searchTerm: string | undefined, options: any) => {
    try {
      const db = DatabaseConnectionPool.getConnection();
      
      // Query for all endpoint-like patterns
      let query = `
        SELECT 
          s.name,
          s.type,
          s.signature,
          s.line_start,
          s.metadata,
          f.relative_path as file_path
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE 
          s.type IN ('endpoint', 'decorator', 'function', 'method')
          AND (
            s.name LIKE '%router.%' OR
            s.name LIKE '%app.%' OR
            s.name LIKE '@%' OR
            s.signature LIKE '%@router%' OR
            s.signature LIKE '%@app%' OR
            s.signature LIKE '%.get(%' OR
            s.signature LIKE '%.post(%' OR
            s.signature LIKE '%.put(%' OR
            s.signature LIKE '%.delete(%' OR
            s.signature LIKE '%.patch(%'
          )
      `;
      
      if (searchTerm) {
        const validated = validateSearchTerm(searchTerm);
        query += ` AND (
          s.name LIKE '%${validated}%' OR
          s.signature LIKE '%${validated}%' OR
          f.relative_path LIKE '%${validated}%'
        )`;
      }
      
      query += ' ORDER BY f.relative_path, s.line_start';
      
      const results = db.getDatabase().prepare(query).all() as any[];
      
      // Process and extract endpoint information
      const endpoints: EndpointInfo[] = [];
      
      for (const row of results) {
        // Try to extract method and path from signature or name
        let method = 'GET';
        let path = '/unknown';
        let handler = row.name;
        
        // Extract from decorators like @router.post("/path")
        const decoratorMatch = row.signature?.match(/@(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/i);
        if (decoratorMatch) {
          method = decoratorMatch[1].toUpperCase();
          path = decoratorMatch[2];
        }
        
        // Extract from method calls like router.get("/path", handler)
        const methodMatch = row.signature?.match(/(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/i);
        if (methodMatch) {
          method = methodMatch[1].toUpperCase();
          path = methodMatch[2];
        }
        
        // Extract from name patterns
        if (!decoratorMatch && !methodMatch) {
          const nameMatch = row.name.match(/@?(?:router|app)\.(get|post|put|delete|patch)/i);
          if (nameMatch) {
            method = nameMatch[1].toUpperCase();
            // Try to get path from signature
            const pathMatch = row.signature?.match(/["']([^"']+)["']/);
            if (pathMatch) {
              path = pathMatch[1];
            }
          }
        }
        
        // Get handler name from metadata or surrounding context
        if (row.metadata) {
          try {
            const metadata = JSON.parse(row.metadata);
            if (metadata.handler) {
              handler = metadata.handler;
            } else if (metadata.functionName) {
              handler = metadata.functionName;
            }
          } catch {
            // Ignore metadata parsing errors
          }
        }
        
        // Skip if it doesn't look like a real endpoint
        if (path === '/unknown' && !row.signature?.includes('(')) {
          continue;
        }
        
        endpoints.push({
          method,
          path,
          handler,
          file: row.file_path,
          line: row.line_start
        });
      }
      
      // Output based on format
      if (options.format === 'json') {
        console.log(JSON.stringify(endpoints, null, 2));
      } else if (options.format === 'ai') {
        outputAIFormat(endpoints, options.groupBy);
      } else {
        outputHumanFormat(endpoints, options.groupBy);
      }
      
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(chalk.red('❌ Validation error:'), error.message);
      } else {
        console.error(chalk.red('❌ Failed to list endpoints:'), error instanceof Error ? error.message : error);
      }
      process.exit(1);
    }
  });

function outputAIFormat(endpoints: EndpointInfo[], groupBy: string) {
  console.log('# API Endpoints\n');
  
  if (endpoints.length === 0) {
    console.log('No endpoints found in the codebase.');
    return;
  }
  
  if (groupBy === 'method') {
    // Group by HTTP method
    const byMethod: Record<string, EndpointInfo[]> = {};
    endpoints.forEach(ep => {
      if (!byMethod[ep.method]) byMethod[ep.method] = [];
      byMethod[ep.method].push(ep);
    });
    
    Object.entries(byMethod).forEach(([method, eps]) => {
      console.log(`## ${method} Endpoints (${eps.length})\n`);
      eps.forEach(ep => {
        console.log(`- \`${ep.path}\` → ${ep.handler} (${ep.file}:${ep.line})`);
      });
      console.log();
    });
  } else if (groupBy === 'path') {
    // Sort by path
    endpoints.sort((a, b) => a.path.localeCompare(b.path));
    console.log('## All Endpoints\n');
    endpoints.forEach(ep => {
      console.log(`- \`${ep.method} ${ep.path}\` → ${ep.handler} (${ep.file}:${ep.line})`);
    });
  } else {
    // Group by file (default)
    const byFile: Record<string, EndpointInfo[]> = {};
    endpoints.forEach(ep => {
      if (!byFile[ep.file]) byFile[ep.file] = [];
      byFile[ep.file].push(ep);
    });
    
    Object.entries(byFile).forEach(([file, eps]) => {
      console.log(`## ${file}\n`);
      eps.forEach(ep => {
        console.log(`- \`${ep.method} ${ep.path}\` → ${ep.handler} (line ${ep.line})`);
      });
      console.log();
    });
  }
  
  console.log(`\nTotal endpoints: ${endpoints.length}`);
}

function outputHumanFormat(endpoints: EndpointInfo[], groupBy: string) {
  console.log(chalk.blue('🔍 API Endpoints'));
  console.log(chalk.gray('═'.repeat(60)));
  
  if (endpoints.length === 0) {
    console.log(chalk.yellow('No endpoints found.'));
    return;
  }
  
  if (groupBy === 'file') {
    const byFile: Record<string, EndpointInfo[]> = {};
    endpoints.forEach(ep => {
      if (!byFile[ep.file]) byFile[ep.file] = [];
      byFile[ep.file].push(ep);
    });
    
    Object.entries(byFile).forEach(([file, eps]) => {
      console.log(chalk.green(`\n📁 ${file}`));
      eps.forEach(ep => {
        console.log(`   ${chalk.cyan(ep.method.padEnd(7))} ${chalk.white(ep.path.padEnd(30))} → ${chalk.yellow(ep.handler)} ${chalk.gray(`(line ${ep.line})`)}`);
      });
    });
  } else {
    endpoints.forEach(ep => {
      console.log(`${chalk.cyan(ep.method.padEnd(7))} ${chalk.white(ep.path.padEnd(30))} → ${chalk.yellow(ep.handler)} ${chalk.gray(`(${ep.file}:${ep.line})`)}`);
    });
  }
  
  console.log(chalk.gray('\n' + '═'.repeat(60)));
  console.log(chalk.blue(`Total: ${endpoints.length} endpoints`));
}