import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GitCommit, GitFileChange, GitBlame, GitHistory } from '../types/index.js';

export class GitAnalyzer {
  private projectRoot: string;
  private isGitRepo: boolean;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.isGitRepo = this.checkGitRepo();
  }

  private checkGitRepo(): boolean {
    return existsSync(join(this.projectRoot, '.git'));
  }

  private execGit(command: string): string {
    if (!this.isGitRepo) {
      throw new Error('Not a git repository');
    }
    
    try {
      return execSync(`git ${command}`, {
        cwd: this.projectRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large outputs
      });
    } catch (error) {
      // Return empty string for commands that might fail (e.g., no commits yet)
      if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 128) {
        return '';
      }
      throw error;
    }
  }

  public async getGitHistory(filePath: string, symbolName?: string, lineStart?: number, lineEnd?: number): Promise<GitHistory | null> {
    if (!this.isGitRepo) {
      return null;
    }

    try {
      // Get recent commits for the file
      const recentCommits = this.getRecentCommits(filePath, 20);
      
      // Get file changes
      const fileChanges = this.getFileChanges(filePath);
      
      // Get blame information if we have line numbers OR try to find symbol in file
      let blame: GitBlame[] = [];
      if (lineStart && lineEnd) {
        blame = this.getBlameForLines(filePath, lineStart, lineEnd);
      } else if (symbolName) {
        // Try to find the symbol in the file and get blame for those lines
        const lineInfo = this.findSymbolLines(filePath, symbolName);
        if (lineInfo) {
          blame = this.getBlameForLines(filePath, lineInfo.start, lineInfo.end);
        }
      }
      
      // Calculate statistics
      const allCommits = this.getAllCommitsForFile(filePath);
      const uniqueAuthors = [...new Set(allCommits.map(c => c.author))];
      
      // Get change frequency
      const changeFrequency = this.calculateChangeFrequency(allCommits);
      
      // Find related files (files often changed together)
      const relatedFiles = this.findRelatedFiles(filePath);
      
      const history: GitHistory = {
        symbol: symbolName || 'file',
        filePath,
        recentCommits,
        fileChanges,
        blame,
        totalCommits: allCommits.length,
        uniqueAuthors,
        lastModified: recentCommits[0]?.date || new Date(),
        firstSeen: allCommits[allCommits.length - 1]?.date || new Date(),
        changeFrequency,
        relatedFiles
      };
      
      return history;
    } catch {
      // Git operations may fail if not in a git repository
      return null;
    }
  }

  private parseCommit(logLine: string): GitCommit | null {
    // Remove quotes if present
    logLine = logLine.replace(/^"|"$/g, '');
    // Format: hash|author|email|date|message|files|insertions|deletions
    const parts = logLine.split('|');
    if (parts.length < 5) return null;
    
    return {
      hash: parts[0],
      author: parts[1],
      email: parts[2],
      date: new Date(parts[3]),
      message: parts[4],
      filesChanged: parseInt(parts[5]) || 0,
      insertions: parseInt(parts[6]) || 0,
      deletions: parseInt(parts[7]) || 0
    };
  }

  public getRecentCommits(filePath?: string, limit: number = 10): GitCommit[] {
    const fileArg = filePath ? `-- "${filePath}"` : '';
    const format = `--pretty=format:"%H|%an|%ae|%aI|%s|0|0|0"`;
    
    const output = this.execGit(`log ${format} -n ${limit} ${fileArg}`);
    if (!output) return [];
    
    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => this.parseCommit(line))
      .filter((commit): commit is GitCommit => commit !== null);
  }

  private getAllCommitsForFile(filePath: string): GitCommit[] {
    const format = `--pretty=format:"%H|%an|%ae|%aI|%s|0|0|0"`;
    const output = this.execGit(`log ${format} -- "${filePath}"`);
    if (!output) return [];
    
    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => this.parseCommit(line))
      .filter((commit): commit is GitCommit => commit !== null);
  }

  private getFileChanges(filePath: string): GitFileChange[] {
    // Get detailed changes for each commit
    const commits = this.getRecentCommits(filePath, 10);
    const changes: GitFileChange[] = [];
    
    for (const commit of commits) {
      try {
        // Get stats for this specific commit and file
        const stats = this.execGit(`show --stat --format="" ${commit.hash} -- "${filePath}"`);
        
        let insertions = 0;
        let deletions = 0;
        let changeType: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified';
        
        // Parse the stat output
        const statMatch = stats.match(/(\d+) insertion.*?(\d+) deletion/);
        if (statMatch) {
          insertions = parseInt(statMatch[1]) || 0;
          deletions = parseInt(statMatch[2]) || 0;
        }
        
        // Check if file was added or deleted in this commit
        const nameStatus = this.execGit(`show --name-status --format="" ${commit.hash} -- "${filePath}"`);
        if (nameStatus.startsWith('A\t')) {
          changeType = 'added';
        } else if (nameStatus.startsWith('D\t')) {
          changeType = 'deleted';
        } else if (nameStatus.startsWith('R')) {
          changeType = 'renamed';
        }
        
        changes.push({
          commit,
          filePath,
          changeType,
          insertions,
          deletions
        });
      } catch {
        // Skip commits that might have issues
        continue;
      }
    }
    
    return changes;
  }

  private getBlameForLines(filePath: string, lineStart: number, lineEnd: number): GitBlame[] {
    const blameData: GitBlame[] = [];
    
    try {
      // Use git blame with line range
      const output = this.execGit(`blame -L ${lineStart},${lineEnd} --line-porcelain "${filePath}"`);
      const lines = output.split('\n');
      
      // let currentBlame: Partial<GitBlame> = {};
      let commitHash = '';
      let author = '';
      let authorMail = '';
      let authorTime = '';
      let summary = '';
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.match(/^[0-9a-f]{40} \d+ \d+/)) {
          // New blame entry
          const parts = line.split(' ');
          commitHash = parts[0];
        } else if (line.startsWith('author ')) {
          author = line.substring(7);
        } else if (line.startsWith('author-mail ')) {
          authorMail = line.substring(12).replace(/[<>]/g, '');
        } else if (line.startsWith('author-time ')) {
          authorTime = line.substring(12);
        } else if (line.startsWith('summary ')) {
          summary = line.substring(8);
        } else if (line.startsWith('\t')) {
          // This is the actual line content
          const content = line.substring(1);
          
          blameData.push({
            line: lineStart + blameData.length,
            commit: {
              hash: commitHash,
              author: author,
              email: authorMail,
              date: new Date(parseInt(authorTime) * 1000),
              message: summary,
              filesChanged: 0,
              insertions: 0,
              deletions: 0
            },
            content: content
          });
        }
      }
    } catch {
      // Blame might fail for new files or other reasons
      // Silently continue without blame data
    }
    
    return blameData;
  }

  private calculateChangeFrequency(commits: GitCommit[]): GitHistory['changeFrequency'] {
    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const last90Days = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    
    return {
      last7Days: commits.filter(c => c.date > last7Days).length,
      last30Days: commits.filter(c => c.date > last30Days).length,
      last90Days: commits.filter(c => c.date > last90Days).length
    };
  }

  private findRelatedFiles(filePath: string): { path: string; coChangeCount: number }[] {
    // Find files that are often changed together with this file
    const commits = this.getRecentCommits(filePath, 50);
    const relatedFiles = new Map<string, number>();
    
    for (const commit of commits) {
      try {
        // Get all files changed in this commit
        const filesInCommit = this.execGit(`show --name-only --format="" ${commit.hash}`)
          .split('\n')
          .filter(f => f.trim() && f !== filePath);
        
        for (const file of filesInCommit) {
          relatedFiles.set(file, (relatedFiles.get(file) || 0) + 1);
        }
      } catch {
        continue;
      }
    }
    
    // Sort by co-change count and return top 10
    return Array.from(relatedFiles.entries())
      .map(([path, count]) => ({ path, coChangeCount: count }))
      .sort((a, b) => b.coChangeCount - a.coChangeCount)
      .slice(0, 10);
  }

  public async getRecentChanges(days: number = 7): Promise<{ file: string; commits: GitCommit[] }[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    
    const format = `--pretty=format:"%H|%an|%ae|%aI|%s|0|0|0"`;
    const output = this.execGit(`log ${format} --since="${since.toISOString()}" --name-only`);
    
    if (!output) return [];
    
    const fileCommitMap = new Map<string, GitCommit[]>();
    const lines = output.split('\n');
    let currentCommit: GitCommit | null = null;
    
    for (const line of lines) {
      if (line.includes('|')) {
        // This is a commit line
        currentCommit = this.parseCommit(line);
      } else if (line.trim() && currentCommit) {
        // This is a file path
        const file = line.trim();
        if (!fileCommitMap.has(file)) {
          fileCommitMap.set(file, []);
        }
        fileCommitMap.get(file)!.push(currentCommit);
      }
    }
    
    return Array.from(fileCommitMap.entries())
      .map(([file, commits]) => ({ file, commits }))
      .sort((a, b) => b.commits.length - a.commits.length);
  }

  private findSymbolLines(filePath: string, symbolName: string): { start: number; end: number } | null {
    try {
      // Read the file content
      const fullPath = join(this.projectRoot, filePath);
      
      if (!existsSync(fullPath)) {
        return null;
      }
      
      const content = readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      
      // Search for the symbol definition
      let startLine = -1;
      let endLine = -1;
      let depth = 0;
      let foundSymbol = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Look for various patterns that might indicate the symbol definition
        if (!foundSymbol && (
          line.includes(`function ${symbolName}`) ||
          line.includes(`class ${symbolName}`) ||
          line.includes(`interface ${symbolName}`) ||
          line.includes(`const ${symbolName}`) ||
          line.includes(`let ${symbolName}`) ||
          line.includes(`var ${symbolName}`) ||
          line.includes(`def ${symbolName}`) ||
          line.includes(`type ${symbolName}`) ||
          line.includes(`struct ${symbolName}`) ||
          line.includes(`enum ${symbolName}`)
        )) {
          startLine = i + 1; // Convert to 1-based line numbers
          foundSymbol = true;
        }
        
        // Track braces to find the end of the symbol
        if (foundSymbol) {
          if (line.includes('{')) depth++;
          if (line.includes('}')) {
            depth--;
            if (depth === 0) {
              endLine = i + 1; // Convert to 1-based line numbers
              break;
            }
          }
          // For single-line definitions or languages without braces
          if (depth === 0 && (line.trim() === '' || i === lines.length - 1)) {
            endLine = i + 1;
            break;
          }
        }
      }
      
      // If we found the start but not the end, use a reasonable range
      if (startLine > 0 && endLine === -1) {
        endLine = Math.min(startLine + 20, lines.length);
      }
      
      return startLine > 0 ? { start: startLine, end: endLine } : null;
    } catch {
      return null;
    }
  }
  
  public getLastCommitForLine(filePath: string, lineNumber: number): GitCommit | null {
    try {
      const output = this.execGit(`blame -L ${lineNumber},${lineNumber} --line-porcelain "${filePath}"`);
      const lines = output.split('\n');
      
      let hash = '';
      let author = '';
      let email = '';
      let timestamp = '';
      let message = '';
      
      for (const line of lines) {
        if (line.match(/^[0-9a-f]{40} \d+ \d+/)) {
          hash = line.split(' ')[0];
        } else if (line.startsWith('author ')) {
          author = line.substring(7);
        } else if (line.startsWith('author-mail ')) {
          email = line.substring(12).replace(/[<>]/g, '');
        } else if (line.startsWith('author-time ')) {
          timestamp = line.substring(12);
        } else if (line.startsWith('summary ')) {
          message = line.substring(8);
        }
      }
      
      if (hash) {
        return {
          hash,
          author,
          email,
          date: new Date(parseInt(timestamp) * 1000),
          message,
          filesChanged: 0,
          insertions: 0,
          deletions: 0
        };
      }
    } catch {
      // Blame might fail
    }
    
    return null;
  }
}