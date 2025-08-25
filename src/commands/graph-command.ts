import { Command } from 'commander';
import { PrimordynDB } from '../database/index.js';
import chalk from 'chalk';
import ora from 'ora';
import { getHelpText } from '../utils/help-texts.js';

interface GraphNode {
  name: string;
  type: string;
  file: string;
  signature?: string;
  children: GraphNode[];
  depth: number;
  isCircular?: boolean;
  callCount?: number;
  lineNumber?: number;
}

export const graphCommand =
  new Command('graph')
    .description('Visualize dependency graph for a symbol')
    .argument('<symbol>', 'Symbol name to graph')
    .option('-d, --depth <number>', 'Maximum depth to traverse (default: 3)', parseInt, 3)
    .option('--reverse', 'Show reverse dependencies (what depends on this)')
    .option('--format <type>', 'Output format: ascii, dot, mermaid (default: ascii)', 'ascii')
    .option('--show-files', 'Include file names in the graph')
    .option('--show-signatures', 'Include function/method signatures in the graph')
    .option('--no-colors', 'Disable colored output')
    .option('--layout <type>', 'Tree layout: tree, flat (default: tree)', 'tree')
    .addHelpText('after', getHelpText('graph'))
    .action(async (symbolName: string, options) => {
      const spinner = ora('Building dependency graph...').start();
      
      try {
        const db = new PrimordynDB();
        // const projectRoot = process.cwd();
        // const dbPath = join(projectRoot, '.primordyn', 'context.db');
        
        const dbInfo = await db.getDatabaseInfo();
        if (dbInfo.fileCount === 0) {
          spinner.fail(chalk.red('No index found. Run "primordyn index" first.'));
          process.exit(1);
        }
        
        // Find the target symbol
        const targetStmt = db.getDatabase().prepare(`
          SELECT s.*, f.relative_path, f.path as file_path, s.signature, s.line_start
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
        
        function buildTree(name: string, symbolId: number | null, depth: number, type?: string, file?: string, signature?: string, lineNumber?: number): GraphNode | null {
          if (depth > options.depth) return null;
          
          const key = symbolId ? `id:${symbolId}` : `name:${name}`;
          if (visited.has(key)) {
            return { 
              name, 
              type: type || '', 
              file: file || '', 
              signature,
              children: [], 
              depth,
              isCircular: true,
              lineNumber
            };
          }
          visited.add(key);
          
          let deps: any[];
          if (symbolId) {
            const query = options.reverse ? `
              SELECT DISTINCT
                s.name,
                s.type,
                s.id,
                s.signature,
                s.line_start,
                f.relative_path as file,
                f.path as file_path,
                COUNT(*) as call_count
              FROM call_graph cg
              JOIN symbols s ON cg.caller_symbol_id = s.id
              JOIN files f ON s.file_id = f.id
              WHERE cg.callee_symbol_id = ?
              GROUP BY s.id
            ` : `
              SELECT DISTINCT
                s.name,
                s.type,
                s.id,
                s.signature,
                s.line_start,
                f.relative_path as file,
                f.path as file_path,
                COUNT(*) as call_count
              FROM call_graph cg
              JOIN symbols s ON cg.callee_symbol_id = s.id
              JOIN files f ON s.file_id = f.id
              WHERE cg.caller_symbol_id = ?
              GROUP BY s.id
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
                s.signature,
                s.line_start,
                f.relative_path as file,
                f.path as file_path,
                COUNT(*) as call_count
              FROM call_graph cg
              JOIN symbols s ON cg.caller_symbol_id = s.id
              JOIN files f ON s.file_id = f.id
              WHERE cg.callee_symbol_id IN (
                SELECT id FROM symbols WHERE name = ?
              )
              GROUP BY s.id
            ` : `
              SELECT DISTINCT
                s.name,
                s.type,
                s.id,
                s.signature,
                s.line_start,
                f.relative_path as file,
                f.path as file_path,
                COUNT(*) as call_count
              FROM call_graph cg
              JOIN symbols s ON cg.callee_symbol_id = s.id
              JOIN files f ON s.file_id = f.id
              WHERE cg.caller_symbol_id IN (
                SELECT id FROM symbols WHERE name = ?
              )
              GROUP BY s.id
            `;
            
            const stmt = db.getDatabase().prepare(query);
            deps = stmt.all(name) as any[];
          }
          
          const children: GraphNode[] = [];
          for (const dep of deps) {
            const child = buildTree(dep.name, dep.id, depth + 1, dep.type, dep.file, dep.signature, dep.line_start);
            if (child) {
              child.callCount = dep.call_count;
              children.push(child);
            }
          }
          
          return {
            name,
            type: type || 'unknown',
            file: file || '',
            signature,
            children,
            depth,
            lineNumber
          };
        }
        
        const tree = buildTree(targetSymbol.name, targetSymbol.id, 0, targetSymbol.type, targetSymbol.relative_path, targetSymbol.signature, targetSymbol.line_start);
        
        spinner.stop();
        
        // Debug: Log tree structure
        if (process.env.DEBUG) {
          console.log('Tree structure:', JSON.stringify(tree, null, 2));
        }
        
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
          if (options.layout === 'flat') {
            console.log('\n' + renderFlatTree(tree, options));
          } else {
            console.log('\n' + renderAsciiTree(tree, options));
          }
        }
        
        // Enhanced Summary
        const stats = gatherStatistics(tree);
        
        console.log(chalk.yellow('\n📊 Graph Statistics:'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`  ${chalk.cyan('Total Nodes:')} ${chalk.white(stats.totalNodes)}`);
        console.log(`  ${chalk.cyan('Maximum Depth:')} ${chalk.white(stats.maxDepth)}`);
        console.log(`  ${chalk.cyan('Unique Files:')} ${chalk.white(stats.uniqueFiles)}`);
        
        if (stats.circularDeps > 0) {
          console.log(`  ${chalk.red('⚠️  Circular Dependencies:')} ${chalk.red(stats.circularDeps)}`);
        }
        
        console.log('\n' + chalk.yellow('📈 Node Type Distribution:'));
        console.log(chalk.gray('─'.repeat(40)));
        Object.entries(stats.typeDistribution).forEach(([type, count]) => {
          const icon = getTypeIcon(type);
          const percentage = ((count / stats.totalNodes) * 100).toFixed(1);
          const bar = '█'.repeat(Math.floor((count / stats.totalNodes) * 20));
          console.log(`  ${icon} ${chalk.cyan(type.padEnd(12))} ${chalk.gray(bar)} ${count} (${percentage}%)`);
        });
        
        if (stats.mostConnected.length > 0) {
          console.log('\n' + chalk.yellow('🔗 Most Connected Nodes:'));
          console.log(chalk.gray('─'.repeat(40)));
          stats.mostConnected.slice(0, 5).forEach(({ name, connections }) => {
            console.log(`  • ${chalk.white(name)} - ${chalk.green(connections)} connections`);
          });
        }
        
        db.close();
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        process.exit(1);
      }
    });

function renderAsciiTree(node: GraphNode, options: any, prefix = '', isLast = true): string {
  let result = '';
  
  // Build node label with type icon and metadata
  const typeIcon = getTypeIcon(node.type);
  const fileInfo = options.showFiles && node.file ? 
    chalk.gray(` [${node.file}:${node.lineNumber || '?'}]`) : '';
  const callInfo = node.callCount && node.callCount > 1 ? 
    chalk.yellow(` (×${node.callCount})`) : '';
  const circularInfo = node.isCircular ? chalk.red(' ⟲') : '';
  
  const nodeLabel = `${typeIcon} ${node.name}${callInfo}${circularInfo}${fileInfo}`;
  
  // Root node
  if (node.depth === 0) {
    result += chalk.cyan.bold(`\n${typeIcon} ${node.name}`) + fileInfo + '\n';
    if (node.signature && options.showSignatures !== false) {
      result += chalk.gray(`   ${truncateSignature(node.signature, 80)}\n`);
    }
    result += chalk.gray('─'.repeat(Math.min(80, nodeLabel.length + 4))) + '\n';
  } else {
    // Build tree structure with improved connectors
    const connector = isLast ? '└─→ ' : '├─→ ';
    const verticalLine = prefix + (isLast ? '   ' : '│  ');
    
    // Apply color based on node type and state
    let color = chalk.white;
    if (node.isCircular) {
      color = chalk.red;
    } else if (node.type === 'function' || node.type === 'method') {
      color = chalk.green;
    } else if (node.type === 'class' || node.type === 'interface') {
      color = chalk.blue;
    } else if (node.type === 'variable' || node.type === 'const') {
      color = chalk.magenta;
    }
    
    result += prefix + chalk.gray(connector) + color(nodeLabel) + '\n';
    
    // Add signature if available and not too deep
    if (node.signature && node.depth <= 2 && options.showSignatures !== false) {
      result += verticalLine + chalk.gray(`  ${truncateSignature(node.signature, 70)}\n`);
    }
  }
  
  // Process children with proper indentation
  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  
  // Sort children by importance (classes/interfaces first, then functions, then others)
  const sortedChildren = [...node.children].sort((a, b) => {
    const typeOrder: Record<string, number> = {
      'class': 0,
      'interface': 1,
      'function': 2,
      'method': 3,
      'variable': 4,
      'const': 5
    };
    const aOrder = typeOrder[a.type] ?? 6;
    const bOrder = typeOrder[b.type] ?? 6;
    return aOrder - bOrder;
  });
  
  sortedChildren.forEach((child, index) => {
    const isLastChild = index === sortedChildren.length - 1;
    result += renderAsciiTree(child, options, childPrefix, isLastChild);
  });
  
  return result;
}

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    'function': '𝑓',
    'method': '𝑚',
    'class': '◆',
    'interface': '◇',
    'variable': '𝑣',
    'const': '𝑐',
    'type': '𝑡',
    'enum': '𝑒',
    'module': '📦',
    'namespace': '□'
  };
  return icons[type.toLowerCase()] || '•';
}

function truncateSignature(sig: string, maxLength: number): string {
  if (sig.length <= maxLength) return sig;
  return sig.substring(0, maxLength - 3) + '...';
}

function renderFlatTree(node: GraphNode, options: any): string {
  const lines: string[] = [];
  const visited = new Set<string>();
  
  // Breadth-first traversal for flat layout
  const queue: Array<{node: GraphNode, level: number}> = [{node, level: 0}];
  const levelGroups: Map<number, GraphNode[]> = new Map();
  
  while (queue.length > 0) {
    const {node: current, level} = queue.shift()!;
    const key = `${current.file}:${current.name}`;
    
    if (visited.has(key)) continue;
    visited.add(key);
    
    if (!levelGroups.has(level)) {
      levelGroups.set(level, []);
    }
    levelGroups.get(level)!.push(current);
    
    // Add children to queue
    for (const child of current.children) {
      if (!child.isCircular) {
        queue.push({node: child, level: level + 1});
      }
    }
  }
  
  // Render each level
  const maxLevel = Math.max(...levelGroups.keys());
  
  for (let level = 0; level <= maxLevel; level++) {
    const nodes = levelGroups.get(level) || [];
    
    if (nodes.length === 0) continue;
    
    // Level header
    lines.push('');
    if (level === 0) {
      lines.push(chalk.cyan.bold(`═══ Root Symbol ═══`));
    } else {
      lines.push(chalk.yellow(`═══ Level ${level} (${nodes.length} nodes) ═══`));
    }
    
    // Render nodes at this level
    for (const n of nodes) {
      const typeIcon = getTypeIcon(n.type);
      const fileInfo = options.showFiles && n.file ? 
        chalk.gray(` [${n.file}:${n.lineNumber || '?'}]`) : '';
      const callInfo = n.callCount && n.callCount > 1 ? 
        chalk.yellow(` (×${n.callCount})`) : '';
      const circularInfo = n.isCircular ? chalk.red(' ⟲') : '';
      
      let color = chalk.white;
      if (n.type === 'function' || n.type === 'method') {
        color = chalk.green;
      } else if (n.type === 'class' || n.type === 'interface') {
        color = chalk.blue;
      } else if (n.type === 'variable' || n.type === 'const') {
        color = chalk.magenta;
      }
      
      lines.push(`  ${typeIcon} ${color(n.name)}${callInfo}${circularInfo}${fileInfo}`);
      
      if (n.signature && options.showSignatures) {
        lines.push(chalk.gray(`     ${truncateSignature(n.signature, 70)}`));
      }
    }
  }
  
  return lines.join('\\n');
}

function renderDot(node: GraphNode, options: any): string {
  const lines: string[] = ['digraph dependencies {'];
  lines.push('  rankdir=LR;');
  lines.push('  node [fontname="Arial"];');
  lines.push('  edge [fontname="Arial"];');
  lines.push('');
  
  // Style definitions for different node types
  lines.push('  // Node styles');
  lines.push('  node [shape=box, style=rounded];');
  lines.push('');
  
  const nodes = new Map<string, GraphNode>();
  const edges = new Set<string>();
  
  // Collect all nodes first
  function collectNodes(n: GraphNode) {
    const nodeId = n.name.replace(/[^a-zA-Z0-9]/g, '_');
    nodes.set(nodeId, n);
    
    for (const child of n.children) {
      if (!child.isCircular) {
        collectNodes(child);
      }
    }
  }
  
  collectNodes(node);
  
  // Add node definitions with styling
  lines.push('  // Nodes');
  for (const [nodeId, n] of nodes) {
    const shape = getNodeShape(n.type);
    const color = getNodeColor(n.type);
    const style = n.depth === 0 ? 'filled,bold' : 'filled';
    const label = options.showFiles ? `${n.name}\\n${n.file}` : n.name;
    
    lines.push(`  "${nodeId}" [label="${label}", shape=${shape}, fillcolor="${color}", style="${style}"];`);
  }
  lines.push('');
  
  // Build edges
  lines.push('  // Edges');
  function traverse(n: GraphNode) {
    const nodeId = n.name.replace(/[^a-zA-Z0-9]/g, '_');
    
    for (const child of n.children) {
      const childId = child.name.replace(/[^a-zA-Z0-9]/g, '_');
      const edgeStyle = child.isCircular ? ', color="red", style="dashed"' : '';
      const edgeLabel = child.callCount && child.callCount > 1 ? `, label="${child.callCount}x"` : '';
      const edge = `  "${nodeId}" -> "${childId}"[${edgeStyle}${edgeLabel}];`;
      
      if (!edges.has(edge)) {
        edges.add(edge);
        if (!child.isCircular) {
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

function getNodeShape(type: string): string {
  const shapes: Record<string, string> = {
    'class': 'box',
    'interface': 'diamond',
    'function': 'ellipse',
    'method': 'ellipse',
    'variable': 'plaintext',
    'const': 'plaintext'
  };
  return shapes[type.toLowerCase()] || 'box';
}

function getNodeColor(type: string): string {
  const colors: Record<string, string> = {
    'class': '#e8f4fd',
    'interface': '#fff4e6',
    'function': '#e8f5e8',
    'method': '#e8f5e8',
    'variable': '#fce4ec',
    'const': '#f3e5f5'
  };
  return colors[type.toLowerCase()] || '#f5f5f5';
}

function renderMermaid(node: GraphNode, options: any): string {
  const lines: string[] = ['graph TD'];
  const nodeIds = new Map<string, string>();
  const processedEdges = new Set<string>();
  let idCounter = 0;
  
  function getNodeId(name: string): string {
    if (!nodeIds.has(name)) {
      nodeIds.set(name, `N${idCounter++}`);
    }
    return nodeIds.get(name)!;
  }
  
  // Add style definitions
  lines.push('  %% Style definitions');
  lines.push('  classDef classStyle fill:#e8f4fd,stroke:#1976d2,stroke-width:2px;');
  lines.push('  classDef interfaceStyle fill:#fff4e6,stroke:#f57c00,stroke-width:2px;');
  lines.push('  classDef functionStyle fill:#e8f5e8,stroke:#388e3c,stroke-width:2px;');
  lines.push('  classDef variableStyle fill:#fce4ec,stroke:#c2185b,stroke-width:2px;');
  lines.push('  classDef circularStyle fill:#ffebee,stroke:#d32f2f,stroke-width:2px,stroke-dasharray: 5 5;');
  lines.push('');
  
  const nodeClasses: Map<string, string> = new Map();
  
  function traverse(n: GraphNode, visited = new Set<string>()) {
    const nodeId = getNodeId(n.name);
    const nodeKey = n.name;
    
    if (visited.has(nodeKey)) return;
    visited.add(nodeKey);
    
    // Determine node shape and style
    let nodeDisplay = n.name;
    if (options.showFiles && n.file) {
      // Will be used when rendering node labels
      nodeDisplay = `${n.name}<br/>${n.file}`;
    }
    
    // Store node class for later
    if (n.isCircular) {
      nodeClasses.set(nodeId, 'circularStyle');
    } else if (n.type === 'class') {
      nodeClasses.set(nodeId, 'classStyle');
    } else if (n.type === 'interface') {
      nodeClasses.set(nodeId, 'interfaceStyle');
    } else if (n.type === 'function' || n.type === 'method') {
      nodeClasses.set(nodeId, 'functionStyle');
    } else if (n.type === 'variable' || n.type === 'const') {
      nodeClasses.set(nodeId, 'variableStyle');
    }
    
    for (const child of n.children) {
      const childId = getNodeId(child.name);
      const edgeKey = `${nodeId}-${childId}`;
      
      if (!processedEdges.has(edgeKey)) {
        processedEdges.add(edgeKey);
        
        // Determine edge style
        let edgeStyle = '-->';
        if (child.isCircular) {
          edgeStyle = '-.->'; // Dotted for circular
        }
        
        // Add edge label if there are multiple calls
        let edgeLabel = '';
        if (child.callCount && child.callCount > 1) {
          edgeLabel = `|${child.callCount}x|`;
        }
        
        // Create proper node shapes
        const parentShape = getMermaidShape(n.type, nodeDisplay);
        const childShape = getMermaidShape(child.type, child.name);
        
        lines.push(`  ${nodeId}${parentShape} ${edgeStyle}${edgeLabel} ${childId}${childShape}`);
        
        if (!child.isCircular) {
          traverse(child, visited);
        }
      }
    }
  }
  
  traverse(node);
  
  // Apply styles
  lines.push('');
  lines.push('  %% Apply styles to nodes');
  for (const [nodeId, className] of nodeClasses) {
    lines.push(`  class ${nodeId} ${className}`);
  }
  
  return lines.join('\n');
}

function getMermaidShape(type: string, name: string): string {
  switch (type?.toLowerCase()) {
    case 'class':
      return `[${name}]`; // Rectangle
    case 'interface':
      return `{${name}}`; // Diamond
    case 'function':
    case 'method':
      return `(${name})`; // Rounded
    case 'variable':
    case 'const':
      return `[/${name}/]`; // Parallelogram
    default:
      return `[${name}]`;
  }
}

// Note: These functions are now integrated into gatherStatistics for better performance

interface GraphStatistics {
  totalNodes: number;
  maxDepth: number;
  uniqueFiles: number;
  circularDeps: number;
  typeDistribution: Record<string, number>;
  mostConnected: Array<{ name: string; connections: number }>;
}

function gatherStatistics(node: GraphNode): GraphStatistics {
  const visited = new Set<string>();
  const files = new Set<string>();
  const typeCount: Record<string, number> = {};
  const connectionCount: Map<string, number> = new Map();
  let circularCount = 0;
  let maxDepth = 0;
  
  function traverse(n: GraphNode) {
    const key = `${n.file}:${n.name}`;
    if (visited.has(key)) return;
    visited.add(key);
    
    // Track file
    if (n.file) files.add(n.file);
    
    // Track type
    typeCount[n.type] = (typeCount[n.type] || 0) + 1;
    
    // Track connections
    connectionCount.set(n.name, n.children.length);
    
    // Track circular dependencies
    if (n.isCircular) circularCount++;
    
    // Track depth
    maxDepth = Math.max(maxDepth, n.depth);
    
    // Traverse children
    n.children.forEach(child => traverse(child));
  }
  
  traverse(node);
  
  // Sort connections
  const mostConnected = Array.from(connectionCount.entries())
    .map(([name, connections]) => ({ name, connections }))
    .sort((a, b) => b.connections - a.connections);
  
  return {
    totalNodes: visited.size,
    maxDepth,
    uniqueFiles: files.size,
    circularDeps: circularCount,
    typeDistribution: typeCount,
    mostConnected
  };
}