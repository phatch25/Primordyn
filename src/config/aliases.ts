import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface SearchAlias {
  name: string;
  expansion: string;
  description?: string;
}

export class AliasManager {
  private aliasFilePath: string;
  private aliases: Map<string, SearchAlias> = new Map();
  
  constructor(projectRoot: string) {
    this.aliasFilePath = join(projectRoot, '.primordyn', 'aliases.json');
    this.loadAliases();
  }
  
  private loadAliases(): void {
    if (existsSync(this.aliasFilePath)) {
      try {
        const content = readFileSync(this.aliasFilePath, 'utf-8');
        const data = JSON.parse(content);
        
        // Support both array and object format
        if (Array.isArray(data)) {
          data.forEach(alias => {
            this.aliases.set(alias.name.toLowerCase(), alias);
          });
        } else if (data.aliases) {
          data.aliases.forEach((alias: SearchAlias) => {
            this.aliases.set(alias.name.toLowerCase(), alias);
          });
        }
      } catch (error) {
        console.error('Failed to load aliases:', error);
      }
    } else {
      // Create default aliases on first run
      this.initializeDefaults();
    }
  }
  
  private initializeDefaults(): void {
    const defaultAliases: SearchAlias[] = [
      {
        name: 'database',
        expansion: 'query OR select OR insert OR update OR delete OR transaction OR repository',
        description: 'Database operations and queries'
      },
      {
        name: 'api',
        expansion: 'router OR route OR endpoint OR controller OR handler OR middleware',
        description: 'API endpoints and handlers'
      },
      {
        name: 'auth',
        expansion: 'login OR authenticate OR authorize OR token OR session OR jwt OR oauth',
        description: 'Authentication and authorization'
      },
      {
        name: 'test',
        expansion: 'test OR spec OR describe OR it OR expect OR assert OR mock',
        description: 'Test files and testing code'
      },
      {
        name: 'config',
        expansion: 'config OR settings OR environment OR env OR options',
        description: 'Configuration and settings'
      },
      {
        name: 'error',
        expansion: 'error OR exception OR throw OR catch OR try OR fail',
        description: 'Error handling and exceptions'
      },
      {
        name: 'cache',
        expansion: 'cache OR redis OR memcache OR memoize OR cached',
        description: 'Caching logic and cache operations'
      },
      {
        name: 'log',
        expansion: 'log OR logger OR console OR debug OR info OR warn OR error',
        description: 'Logging and debugging'
      }
    ];
    
    defaultAliases.forEach(alias => {
      this.aliases.set(alias.name.toLowerCase(), alias);
    });
    
    // Save defaults
    this.saveAliases();
  }
  
  private saveAliases(): void {
    try {
      const dir = dirname(this.aliasFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      const data = {
        aliases: Array.from(this.aliases.values()),
        _comment: 'Add custom search aliases here. Each alias expands to multiple search terms.'
      };
      
      writeFileSync(this.aliasFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save aliases:', error);
    }
  }
  
  public expandAlias(searchTerm: string): string {
    const lowerTerm = searchTerm.toLowerCase();
    const alias = this.aliases.get(lowerTerm);
    
    if (alias) {
      return alias.expansion;
    }
    
    // Check if it's a multi-word query that starts with an alias
    const words = lowerTerm.split(/\s+/);
    if (words.length > 1) {
      const firstWord = words[0];
      const alias = this.aliases.get(firstWord);
      if (alias) {
        // Expand first word and keep the rest
        const remainingWords = words.slice(1).join(' ');
        return `(${alias.expansion}) AND ${remainingWords}`;
      }
    }
    
    return searchTerm;
  }
  
  public addAlias(name: string, expansion: string, description?: string): void {
    this.aliases.set(name.toLowerCase(), {
      name,
      expansion,
      description
    });
    this.saveAliases();
  }
  
  public removeAlias(name: string): boolean {
    const deleted = this.aliases.delete(name.toLowerCase());
    if (deleted) {
      this.saveAliases();
    }
    return deleted;
  }
  
  public listAliases(): SearchAlias[] {
    return Array.from(this.aliases.values());
  }
  
  public getAlias(name: string): SearchAlias | undefined {
    return this.aliases.get(name.toLowerCase());
  }
}