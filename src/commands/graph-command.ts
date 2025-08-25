import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import chalk from 'chalk';
import ora from 'ora';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface GraphNode {
  name: string;
  type: string;
  file: string;
  children: GraphNode[];
  depth: number;
}

export const graphCommand =
  new Command('graph')
    .description('Visualize dependency graph for a symbol')
    .argument('<symbol>', 'Symbol name to graph')
    .option('-d, --depth <number>', 'Maximum depth to traverse (default: 3)', parseInt, 3)
    .option('--reverse', 'Show reverse dependencies (what depends on this)')
    .option('--format <type>', 'Output format: ascii, dot, mermaid (default: ascii)', 'ascii')
    .option('--show-files', 'Include file names in the graph')
    .action(async (symbolName: string, options) => {
      const spinner = ora('Building dependency graph...').start();
      
      try {
        const db = new PrimordynDB();
        const projectRoot = process.cwd();
        const dbPath = join(projectRoot, '.primordyn', 'context.db');
        
        const dbInfo = await db.getDatabaseInfo();
        if (dbInfo.fileCount === 0) {
          spinner.fail(chalk.red('No index found. Run "primordyn index" first.'));
          process.exit(1);
        }
        
        // Find the target symbol
        const targetStmt = db.getDatabase().prepare(`
          SELECT s.*, f.relative_path, f.path as file_path 
          FROM symbols s
          JOIN files f ON s.file_id = f.id
          WHERE s.name = ?
          LIMIT 1
        `);
        const targetSymbol = targetStmt.get(symbolName) as any;
        
        if (!targetSymbol) {
          spinner.fail(chalk.red(`Symbol "${symbolName}" not found`));
          db.close();
          process.exit(1);
        }
        
        // Build the dependency tree
        const visited = new Set<string>();
        
        function buildTree(name: string, symbolId: number | null, depth: number, type?: string, file?: string): GraphNode | null {
          if (depth > options.depth) return null;
          
          const key = symbolId ? `id:${symbolId}` : `name:${name}`;
          if (visited.has(key)) {
            return { name: `${name} (circular)`, type: type || '', file: file || '', children: [], depth };
          }
          visited.add(key);
          
          let deps: any[];
          if (symbolId) {
            const query = options.reverse ? `
              SELECT DISTINCT
                s.name,
                s.type,
                s.id,
                f.relative_path as file,
                f.path as file_path
              FROM call_graph cg
              JOIN symbols s ON cg.caller_symbol_id = s.id
              JOIN files f ON s.file_id = f.id
              WHERE cg.callee_symbol_id = ?
            ` : `
              SELECT DISTINCT
                s.name,
                s.type,
                s.id,
                f.relative_path as file,
                f.path as file_path
              FROM call_graph cg
              JOIN symbols s ON cg.callee_symbol_id = s.id
              JOIN files f ON s.file_id = f.id
              WHERE cg.caller_symbol_id = ?
            `;
            
            const stmt = db.getDatabase().prepare(query);
            deps = stmt.all(symbolId) as any[];
          } else {
            // Fallback to name-based search
            const query = options.reverse ? `
              SELECT DISTINCT
                s.name,
                s.type,
                s.id,
                f.relative_path as file,
                f.path as file_path
              FROM call_graph cg
              JOIN symbols s ON cg.caller_symbol_id = s.id
              JOIN files f ON s.file_id = f.id
              WHERE cg.callee_symbol_id IN (
                SELECT id FROM symbols WHERE name = ?
              )
            ` : `
              SELECT DISTINCT
                s.name,
                s.type,
                s.id,
                f.relative_path as file,
                f.path as file_path
              FROM call_graph cg
              JOIN symbols s ON cg.callee_symbol_id = s.id
              JOIN files f ON s.file_id = f.id
              WHERE cg.caller_symbol_id IN (
                SELECT id FROM symbols WHERE name = ?
              )
            `;
            
            const stmt = db.getDatabase().prepare(query);
            deps = stmt.all(name) as any[];
          }
          
          const children: GraphNode[] = [];
          for (const dep of deps) {
            const child = buildTree(dep.name, dep.id, depth + 1, dep.type, dep.file);
            if (child) children.push(child);
          }
          
          return {
            name,
            type: type || 'unknown',
            file: file || '',
            children,
            depth
          };
        }
        
        const tree = buildTree(targetSymbol.name, targetSymbol.id, 0, targetSymbol.type, targetSymbol.relative_path);
        
        spinner.stop();
        
        if (!tree) {
          console.log(chalk.yellow('No dependencies found'));
          db.close();
          return;
        }
        
        // Render based on format
        if (options.format === 'dot') {
          console.log(renderDot(tree, options));
        } else if (options.format === 'mermaid') {
          console.log(renderMermaid(tree, options));
        } else {
          console.log('\n' + renderAsciiTree(tree, options));
        }
        
        // Summary
        const nodeCount = countNodes(tree);
        const maxDepth = findMaxDepth(tree);
        const circular = hasCircular(tree);
        
        console.log(chalk.yellow('\n📊 Graph Statistics:'));
        console.log(`  • ${chalk.white(nodeCount)} total nodes`);
        console.log(`  • ${chalk.white(maxDepth)} maximum depth`);
        if (circular) {
          console.log(`  • ${chalk.red('⚠️  Circular dependencies detected')}`);
        }
        
        db.close();
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        process.exit(1);
      }
    });

function renderAsciiTree(node: GraphNode, options: any, prefix = '', isLast = true): string {
  let result = '';
  
  const nodeLabel = options.showFiles && node.file ? 
    `${node.name} ${chalk.gray(`(${node.file.split('/').pop()})`)}` : 
    node.name;
  
  if (node.depth === 0) {
    result += chalk.cyan(`${nodeLabel}\n`);
  } else {
    const connector = isLast ? '└── ' : '├── ';
    const color = node.name.includes('(circular)') ? chalk.red : chalk.white;
    result += prefix + connector + color(nodeLabel) + '\n';
  }
  
  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  
  node.children.forEach((child, index) => {
    const isLastChild = index === node.children.length - 1;
    result += renderAsciiTree(child, options, childPrefix, isLastChild);
  });
  
  return result;
}

function renderDot(node: GraphNode, options: any): string {
  const lines: string[] = ['digraph dependencies {'];
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box];');
  
  const edges = new Set<string>();
  
  function traverse(n: GraphNode) {
    const nodeId = n.name.replace(/[^a-zA-Z0-9]/g, '_');
    
    for (const child of n.children) {
      const childId = child.name.replace(/[^a-zA-Z0-9]/g, '_');
      const edge = `  "${nodeId}" -> "${childId}";`;
      
      if (!edges.has(edge)) {
        edges.add(edge);
        if (!child.name.includes('(circular)')) {
          traverse(child);
        }
      }
    }
  }
  
  traverse(node);
  lines.push(...Array.from(edges));
  lines.push('}');
  
  return lines.join('\n');
}

function renderMermaid(node: GraphNode, options: any): string {
  const lines: string[] = ['graph LR'];
  const nodeIds = new Map<string, string>();
  let idCounter = 0;
  
  function getNodeId(name: string): string {
    if (!nodeIds.has(name)) {
      nodeIds.set(name, `N${idCounter++}`);
    }
    return nodeIds.get(name)!;
  }
  
  function traverse(n: GraphNode) {
    const nodeId = getNodeId(n.name);
    
    for (const child of n.children) {
      const childId = getNodeId(child.name);
      lines.push(`  ${nodeId}[${n.name}] --> ${childId}[${child.name}]`);
      
      if (!child.name.includes('(circular)')) {
        traverse(child);
      }
    }
  }
  
  traverse(node);
  
  return lines.join('\n');
}

function countNodes(node: GraphNode): number {
  const visited = new Set<string>();
  
  function count(n: GraphNode): number {
    const key = `${n.file}:${n.name}`;
    if (visited.has(key)) return 0;
    visited.add(key);
    
    return 1 + n.children.reduce((sum, child) => sum + count(child), 0);
  }
  
  return count(node);
}

function findMaxDepth(node: GraphNode): number {
  if (node.children.length === 0) return node.depth;
  return Math.max(...node.children.map(findMaxDepth));
}

function hasCircular(node: GraphNode): boolean {
  function check(n: GraphNode): boolean {
    if (n.name.includes('(circular)')) return true;
    return n.children.some(check);
  }
  return check(node);
}