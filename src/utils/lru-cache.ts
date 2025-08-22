interface CacheNode<T> {
  key: string;
  value: T;
  timestamp: number;
  prev: CacheNode<T> | null;
  next: CacheNode<T> | null;
}

export class LRUCache<T> {
  private capacity: number;
  private cache: Map<string, CacheNode<T>>;
  private head: CacheNode<T> | null;
  private tail: CacheNode<T> | null;
  private ttl: number; // Time to live in milliseconds

  constructor(capacity: number = 100, ttlSeconds: number = 30) {
    this.capacity = capacity;
    this.cache = new Map();
    this.head = null;
    this.tail = null;
    this.ttl = ttlSeconds * 1000;
  }

  get(key: string): T | null {
    const node = this.cache.get(key);
    
    if (!node) {
      return null;
    }
    
    // Check if expired
    if (Date.now() - node.timestamp > this.ttl) {
      this.remove(node);
      return null;
    }
    
    // Move to head (most recently used)
    this.moveToHead(node);
    return node.value;
  }

  set(key: string, value: T): void {
    const existingNode = this.cache.get(key);
    
    if (existingNode) {
      // Update existing node
      existingNode.value = value;
      existingNode.timestamp = Date.now();
      this.moveToHead(existingNode);
    } else {
      // Create new node
      const newNode: CacheNode<T> = {
        key,
        value,
        timestamp: Date.now(),
        prev: null,
        next: null
      };
      
      this.cache.set(key, newNode);
      this.addToHead(newNode);
      
      // Evict least recently used if at capacity
      if (this.cache.size > this.capacity) {
        this.removeLeastRecentlyUsed();
      }
    }
  }

  private addToHead(node: CacheNode<T>): void {
    node.next = this.head;
    node.prev = null;
    
    if (this.head) {
      this.head.prev = node;
    }
    
    this.head = node;
    
    if (!this.tail) {
      this.tail = node;
    }
  }

  private remove(node: CacheNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }
    
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
    
    this.cache.delete(node.key);
  }

  private moveToHead(node: CacheNode<T>): void {
    if (this.head === node) {
      return;
    }
    
    this.remove(node);
    this.addToHead(node);
  }

  private removeLeastRecentlyUsed(): void {
    if (this.tail) {
      this.remove(this.tail);
    }
  }

  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  size(): number {
    return this.cache.size;
  }

  // Clean up expired entries
  cleanExpired(): void {
    const now = Date.now();
    const expiredNodes: CacheNode<T>[] = [];
    
    for (const node of this.cache.values()) {
      if (now - node.timestamp > this.ttl) {
        expiredNodes.push(node);
      }
    }
    
    for (const node of expiredNodes) {
      this.remove(node);
    }
  }
}