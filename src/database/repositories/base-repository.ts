import Database from 'better-sqlite3';
import { LRUCache } from '../../utils/lru-cache.js';

export abstract class BaseRepository<T = any> {
  protected cache: LRUCache<T>;
  
  constructor(
    protected db: Database.Database,
    cacheSize: number = 100,
    cacheTTL: number = 5 * 60 * 1000 // 5 minutes
  ) {
    this.cache = new LRUCache<T>(cacheSize, cacheTTL);
  }

  protected getCached<R>(key: string, fetcher: () => R): R {
    const cached = this.cache.get(key);
    if (cached !== null) {
      return cached as R;
    }

    const result = fetcher();
    this.cache.set(key, result as unknown as T);
    return result;
  }

  protected invalidateCache(pattern?: string): void {
    if (pattern) {
      // Clear specific keys matching pattern
      // Since LRUCache doesn't support pattern matching, we clear all for now
      this.cache.clear();
    } else {
      this.cache.clear();
    }
  }

  protected buildCacheKey(...parts: (string | number | undefined)[]): string {
    return parts.filter(p => p !== undefined).join(':');
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size(),
      maxSize: (this.cache as any).capacity || 100
    };
  }
}