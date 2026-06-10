/**
 * TTL Cache Manager
 * Unified cache management with time-to-live support
 *
 * This is a shared utility class that can be used by multiple services
 * for consistent cache management throughout the ComfyUI runtime
 */
import debug from 'debug';

const log = debug('lobe-image:comfyui:cache');

/**
 * TTL Cache Manager
 * Provides unified caching with automatic expiration
 */
export class TTLCacheManager {
  private caches = new Map<string, { timestamp: number; value: any }>();
  private readonly ttl: number;

  constructor(ttlMs: number = 60_000) {
    this.ttl = ttlMs;
  }

  /**
   * Get cached value or fetch new one
   * @param key - Cache key
   * @param fetcher - Function to fetch value if not cached or expired
   * @returns Cached or newly fetched value
   */
  async get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.caches.get(key);

    if (cached && now - cached.timestamp < this.ttl) {
      log(`Cache hit for ${key}`);
      return cached.value as T;
    }

    log(`Cache miss for ${key}, fetching...`);
    const value = await fetcher();
    this.caches.set(key, { timestamp: now, value });
    return value;
  }

  /**
   * Invalidate specific cache entry
   * @param key - Cache key to invalidate
   */
  invalidate(key: string): void {
    this.caches.delete(key);
    log(`Cache invalidated for ${key}`);
  }

  /**
   * Clear all cache entries
   */
  invalidateAll(): void {
    const size = this.caches.size;
    this.caches.clear();
    log(`All cache cleared (${size} entries)`);
  }

  /**
   * Get current cache size
   * @returns Number of cached entries
   */
  size(): number {
    return this.caches.size;
  }

  /**
   * Check if a key exists in cache (regardless of TTL)
   * @param key - Cache key to check
   * @returns True if key exists in cache
   */
  has(key: string): boolean {
    return this.caches.has(key);
  }

  /**
   * Check if a key exists and is not expired
   * @param key - Cache key to check
   * @returns True if key exists and is not expired
   */
  isValid(key: string): boolean {
    const cached = this.caches.get(key);
    if (!cached) return false;

    const now = Date.now();
    return now - cached.timestamp < this.ttl;
  }
}
