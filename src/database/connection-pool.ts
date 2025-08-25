import { PrimordynDB } from './index.js';

class DatabaseConnectionPool {
  private static instance: PrimordynDB | null = null;
  private static projectPath: string | null = null;
  private static lastAccess: number = 0;
  private static readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  static getConnection(projectPath: string = process.cwd()): PrimordynDB {
    // If path changed, close old connection and create new one
    if (this.projectPath && this.projectPath !== projectPath) {
      this.close();
    }

    // Create new connection if needed
    if (!this.instance) {
      this.instance = new PrimordynDB(projectPath);
      this.projectPath = projectPath;
    }

    this.lastAccess = Date.now();
    return this.instance;
  }

  static close(): void {
    if (this.instance) {
      this.instance.close();
      this.instance = null;
      this.projectPath = null;
    }
  }

  // Auto-close idle connections
  static startIdleTimer(): void {
    // Only start timer in Node.js environment, not during build
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      setInterval(() => {
        if (this.instance && Date.now() - this.lastAccess > this.IDLE_TIMEOUT) {
          this.close();
        }
      }, 60000); // Check every minute
    }
  }
}

// Don't auto-start the timer - let it be started explicitly if needed

export { DatabaseConnectionPool };