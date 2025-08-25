import { Command } from 'commander';
import { DatabaseConnectionPool } from '../database/connection-pool.js';
import { ContextRetriever } from '../retriever/index.js';
import chalk from 'chalk';

interface GraphNode {
  name: string;
  type: string;
  location: string;
  depth: number;
  children: GraphNode[];
  isCircular?: boolean;
}

export const graphCommand = new Command('graph')
  .description('Visualize symbol dependencies as an ASCII tree')
  .argument('<symbol>', 'Symbol to visualize')
  .option('--depth <n>', 'Max depth to traverse (default: 3)', '3')
  .option('--reverse', 'Show what depends on this symbol (default: show what this depends on)')
  .action(async (symbolName: string, options: any) => {
    try {
      const db = DatabaseConnectionPool.getConnection();
      const retriever = new ContextRetriever(db);
      
      // Check index exists
      const dbInfo = await db.getDatabaseInfo();
      if (dbInfo.fileCount === 0) {
        console.log(chalk.red('No index found. Run "primordyn index" first.'));
        process.exit(1);
      }
      
      // Find the symbol
      const symbols = await retriever.findSymbol(symbolName, {});
      if (symbols.length === 0) {
        console.log(chalk.red(`Symbol "${symbolName}" not found`));
        process.exit(1);
      }
      
      const targetSymbol = symbols[0];
      const maxDepth = parseInt(options.depth || '3');
      const isReverse = options.reverse || false;
      
      console.log(chalk.bold(`\n${isReverse ? 'Reverse ' : ''}Dependency Graph: ${targetSymbol.name}`));
      console.log(chalk.gray(`${targetSymbol.filePath}:${targetSymbol.lineStart}`));
      console.log(chalk.gray(`Type: ${targetSymbol.type}, ID: ${targetSymbol.id}\n`));
      
      // Build the tree
      const visited = new Set<string>();
      
      function buildTree(symbolId: number, depth: number): GraphNode | null {
        if (depth > maxDepth) return null;
        
        const key = `${symbolId}-${depth}`;
        if (visited.has(key)) {
          return null; // Circular dependency
        }
        visited.add(key);
        
        // Get dependencies using raw SQL
        const query = isReverse 
          ? `SELECT DISTINCT caller_symbol_id as symbol_id FROM call_graph WHERE callee_symbol_id = ?`
          : `SELECT DISTINCT callee_symbol_id as symbol_id FROM call_graph WHERE caller_symbol_id = ?`;
        
        const deps = db.getDatabase().prepare(query).all(symbolId) as any[];
        
        // Get symbol info
        const symbolQuery = `SELECT * FROM symbols WHERE id = ?`;
        const symbol = db.getDatabase().prepare(symbolQuery).get(symbolId) as any;
        if (!symbol) return null;
        
        // Get file info for location
        const fileQuery = `SELECT relative_path FROM files WHERE id = ?`;
        const file = db.getDatabase().prepare(fileQuery).get(symbol.file_id) as any;
        
        const node: GraphNode = {
          name: symbol.name,
          type: symbol.type,
          location: file ? `${file.relative_path}:${symbol.line_start}` : '',
          depth,
          children: []
        };
        
        // Add children
        if (depth < maxDepth) {
          for (const dep of deps.slice(0, 10)) { // Limit to 10 children per node
            const childId = dep.symbol_id;
            const child = buildTree(childId, depth + 1);
            if (child) {
              node.children.push(child);
            }
          }
          
          if (deps.length > 10) {
            node.children.push({
              name: `... ${deps.length - 10} more`,
              type: 'info',
              location: '',
              depth: depth + 1,
              children: []
            });
          }
        }
        
        return node;
      }
      
      const tree = buildTree(targetSymbol.id, 0);
      
      if (!tree || (tree.children.length === 0)) {
        console.log(chalk.yellow('No dependencies found'));
        return;
      }
      
      // Render the tree
      function renderTree(node: GraphNode, prefix: string = '', isLast: boolean = true) {
        const connector = isLast ? '└── ' : '├── ';
        const typeIcon = getTypeIcon(node.type);
        
        if (node.depth > 0) {
          console.log(prefix + chalk.gray(connector) + typeIcon + ' ' + chalk.yellow(node.name));
          if (node.location) {
            console.log(prefix + (isLast ? '    ' : '│   ') + chalk.gray(`    ${node.location}`));
          }
        }
        
        const extension = isLast ? '    ' : '│   ';
        node.children.forEach((child, index) => {
          const isLastChild = index === node.children.length - 1;
          renderTree(child, prefix + (node.depth === 0 ? '' : extension), isLastChild);
        });
      }
      
      renderTree(tree);
      
      // Simple summary
      const nodeCount = countNodes(tree);
      const fileCount = countUniqueFiles(tree);
      
      console.log(chalk.gray('\n' + '─'.repeat(50)));
      console.log(chalk.cyan('Summary:'));
      console.log(`  • ${nodeCount} dependencies traversed`);
      console.log(`  • ${fileCount} files involved`);
      console.log(`  • Max depth: ${maxDepth}`);
      
      if (!isReverse) {
        console.log(chalk.gray(`\nTip: Use --reverse to see what depends on ${symbolName}`));
      }
      
    } catch (error) {
      console.error(chalk.red('Graph failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  })
  .addHelpText('after', `
${chalk.bold('Purpose:')}
  Visualize how code is connected. Shows what a symbol calls (dependencies)
  or what calls it (dependents) in an easy-to-read tree format.

${chalk.bold('Examples:')}
  ${chalk.gray('# Show what UserService depends on')}
  $ primordyn graph UserService
  ${chalk.gray('→ Tree showing: UserService calls Database, Logger, AuthService...')}
  
  ${chalk.gray('# Show what depends on UserService')}
  $ primordyn graph UserService --reverse
  ${chalk.gray('→ Tree showing: UserController, AdminPanel call UserService...')}
  
  ${chalk.gray('# Limit depth for focused view')}
  $ primordyn graph DatabaseConnection --depth 2

${chalk.bold('Output format:')}
  UserService
  ├── 𝑓 validateUser
  │   src/validators/user.ts:15
  ├── ◆ Database
  │   src/database/index.ts:10
  │   └── 𝑚 connect
  │       src/database/connection.ts:25
  └── ... 5 more

${chalk.bold('Icons:')}
  𝑓 = function, 𝑚 = method, ◆ = class
  ◇ = interface, 𝑡 = type

${chalk.bold('Use cases:')}
  • Understand dependencies before refactoring
  • Find what will break if you change something
  • Identify tightly coupled code
  • Trace execution flow

${chalk.bold('Tips:')}
  • Default shows dependencies (what this uses)
  • Use --reverse to see dependents (what uses this)
  • Adjust --depth for larger/smaller trees`);

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    'function': '𝑓',
    'method': '𝑚',
    'class': '◆',
    'interface': '◇',
    'type': '𝑡',
    'info': 'ℹ',
    'unknown': '○'
  };
  return chalk.cyan(icons[type.toLowerCase()] || icons.unknown);
}

function countNodes(node: GraphNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function countUniqueFiles(node: GraphNode, files = new Set<string>()): number {
  if (node.location) {
    const file = node.location.split(':')[0];
    if (file) files.add(file);
  }
  node.children.forEach(child => countUniqueFiles(child, files));
  return files.size;
}