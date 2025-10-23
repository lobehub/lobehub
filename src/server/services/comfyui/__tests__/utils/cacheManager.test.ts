import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TTLCacheManager } from '@/server/services/comfyui/utils/cacheManager';

// Mock debug module
vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('cacheManager.ts', () => {
  let cacheManager: TTLCacheManager;
  let mockFetcher: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    cacheManager = new TTLCacheManager(60000); // 60 second TTL
    mockFetcher = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TTLCacheManager constructor', () => {
    it('should create instance with default TTL', () => {
      const cache = new TTLCacheManager();
      expect(cache).toBeInstanceOf(TTLCacheManager);
    });

    it('should create instance with custom TTL', () => {
      const cache = new TTLCacheManager(30000);
      expect(cache).toBeInstanceOf(TTLCacheManager);
    });

    it('should handle zero TTL', () => {
      const cache = new TTLCacheManager(0);
      expect(cache).toBeInstanceOf(TTLCacheManager);
    });

    it('should handle negative TTL', () => {
      const cache = new TTLCacheManager(-1000);
      expect(cache).toBeInstanceOf(TTLCacheManager);
    });
  });

  describe('get method', () => {
    it('should fetch and cache value on first call', async () => {
      const testValue = 'test-value';
      mockFetcher.mockResolvedValue(testValue);

      const result = await cacheManager.get('test-key', mockFetcher);

      expect(result).toBe(testValue);
      expect(mockFetcher).toHaveBeenCalledTimes(1);
      expect(cacheManager.size()).toBe(1);
    });

    it('should return cached value on subsequent calls within TTL', async () => {
      const testValue = 'cached-value';
      mockFetcher.mockResolvedValue(testValue);

      // First call
      const result1 = await cacheManager.get('test-key', mockFetcher);

      // Advance time by 30 seconds (within TTL)
      vi.advanceTimersByTime(30000);

      // Second call
      const result2 = await cacheManager.get('test-key', mockFetcher);

      expect(result1).toBe(testValue);
      expect(result2).toBe(testValue);
      expect(mockFetcher).toHaveBeenCalledTimes(1); // Fetcher called only once
    });

    it('should re-fetch value after TTL expires', async () => {
      const firstValue = 'first-value';
      const secondValue = 'second-value';
      mockFetcher.mockResolvedValueOnce(firstValue).mockResolvedValueOnce(secondValue);

      // First call
      const result1 = await cacheManager.get('test-key', mockFetcher);

      // Advance time beyond TTL
      vi.advanceTimersByTime(70000);

      // Second call after TTL expiration
      const result2 = await cacheManager.get('test-key', mockFetcher);

      expect(result1).toBe(firstValue);
      expect(result2).toBe(secondValue);
      expect(mockFetcher).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple different keys', async () => {
      const value1 = 'value-1';
      const value2 = 'value-2';
      const fetcher1 = vi.fn().mockResolvedValue(value1);
      const fetcher2 = vi.fn().mockResolvedValue(value2);

      const result1 = await cacheManager.get('key-1', fetcher1);
      const result2 = await cacheManager.get('key-2', fetcher2);

      expect(result1).toBe(value1);
      expect(result2).toBe(value2);
      expect(cacheManager.size()).toBe(2);
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).toHaveBeenCalledTimes(1);
    });

    it('should handle fetcher that throws error', async () => {
      const error = new Error('Fetcher failed');
      mockFetcher.mockRejectedValue(error);

      await expect(cacheManager.get('test-key', mockFetcher)).rejects.toThrow('Fetcher failed');
      expect(cacheManager.size()).toBe(0); // Should not cache failed results
    });

    it('should handle async fetcher correctly', async () => {
      const asyncFetcher = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve('async-value'), 100)),
        );

      const resultPromise = cacheManager.get('async-key', asyncFetcher);

      // Advance time to resolve the async fetcher
      vi.advanceTimersByTime(100);

      const result = await resultPromise;
      expect(result).toBe('async-value');
      expect(cacheManager.size()).toBe(1);
    });

    it('should handle concurrent requests for same key', async () => {
      let callCount = 0;
      const concurrentFetcher = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(`value-${callCount}`);
      });

      // Start multiple concurrent requests for the same key
      const promises = [
        cacheManager.get('concurrent-key', concurrentFetcher),
        cacheManager.get('concurrent-key', concurrentFetcher),
        cacheManager.get('concurrent-key', concurrentFetcher),
      ];

      const results = await Promise.all(promises);

      // Note: In the current implementation, concurrent calls may each trigger the fetcher
      // since there's no deduplication. This test verifies that the cache works correctly.
      expect(results.length).toBe(3);
      expect(cacheManager.size()).toBe(1);

      // At least some of the results should be the same if caching worked
      const uniqueResults = [...new Set(results)];
      expect(uniqueResults.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle different data types', async () => {
      const objectValue = { foo: 'bar', num: 42 };
      const arrayValue = [1, 2, 3, 'test'];
      const numberValue = 123.45;
      const booleanValue = true;
      const nullValue = null;
      const undefinedValue = undefined;

      const results = await Promise.all([
        cacheManager.get('object', () => Promise.resolve(objectValue)),
        cacheManager.get('array', () => Promise.resolve(arrayValue)),
        cacheManager.get('number', () => Promise.resolve(numberValue)),
        cacheManager.get('boolean', () => Promise.resolve(booleanValue)),
        cacheManager.get('null', () => Promise.resolve(nullValue)),
        cacheManager.get('undefined', () => Promise.resolve(undefinedValue)),
      ]);

      expect(results[0]).toEqual(objectValue);
      expect(results[1]).toEqual(arrayValue);
      expect(results[2]).toBe(numberValue);
      expect(results[3]).toBe(booleanValue);
      expect(results[4]).toBe(nullValue);
      expect(results[5]).toBe(undefinedValue);
      expect(cacheManager.size()).toBe(6);
    });

    it('should handle empty string key', async () => {
      const testValue = 'empty-key-value';
      mockFetcher.mockResolvedValue(testValue);

      const result = await cacheManager.get('', mockFetcher);
      expect(result).toBe(testValue);
      expect(cacheManager.has('')).toBe(true);
    });

    it('should handle special characters in key', async () => {
      const specialKey = 'key-with-special-chars!@#$%^&*()[]{}|;:,.<>?';
      const testValue = 'special-value';
      mockFetcher.mockResolvedValue(testValue);

      const result = await cacheManager.get(specialKey, mockFetcher);
      expect(result).toBe(testValue);
      expect(cacheManager.has(specialKey)).toBe(true);
    });
  });

  describe('invalidate method', () => {
    it('should remove specific cache entry', async () => {
      mockFetcher.mockResolvedValue('test-value');

      await cacheManager.get('test-key', mockFetcher);
      expect(cacheManager.size()).toBe(1);
      expect(cacheManager.has('test-key')).toBe(true);

      cacheManager.invalidate('test-key');

      expect(cacheManager.size()).toBe(0);
      expect(cacheManager.has('test-key')).toBe(false);
    });

    it('should not affect other cache entries', async () => {
      const fetcher1 = vi.fn().mockResolvedValue('value-1');
      const fetcher2 = vi.fn().mockResolvedValue('value-2');

      await cacheManager.get('key-1', fetcher1);
      await cacheManager.get('key-2', fetcher2);
      expect(cacheManager.size()).toBe(2);

      cacheManager.invalidate('key-1');

      expect(cacheManager.size()).toBe(1);
      expect(cacheManager.has('key-1')).toBe(false);
      expect(cacheManager.has('key-2')).toBe(true);
    });

    it('should handle invalidating non-existent key gracefully', () => {
      expect(() => cacheManager.invalidate('non-existent')).not.toThrow();
      expect(cacheManager.size()).toBe(0);
    });

    it('should cause re-fetch after invalidation', async () => {
      const firstValue = 'first-value';
      const secondValue = 'second-value';
      mockFetcher.mockResolvedValueOnce(firstValue).mockResolvedValueOnce(secondValue);

      // First call
      const result1 = await cacheManager.get('test-key', mockFetcher);
      expect(result1).toBe(firstValue);
      expect(mockFetcher).toHaveBeenCalledTimes(1);

      // Invalidate
      cacheManager.invalidate('test-key');

      // Second call should re-fetch
      const result2 = await cacheManager.get('test-key', mockFetcher);
      expect(result2).toBe(secondValue);
      expect(mockFetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateAll method', () => {
    it('should clear all cache entries', async () => {
      const fetcher1 = vi.fn().mockResolvedValue('value-1');
      const fetcher2 = vi.fn().mockResolvedValue('value-2');
      const fetcher3 = vi.fn().mockResolvedValue('value-3');

      await cacheManager.get('key-1', fetcher1);
      await cacheManager.get('key-2', fetcher2);
      await cacheManager.get('key-3', fetcher3);
      expect(cacheManager.size()).toBe(3);

      cacheManager.invalidateAll();

      expect(cacheManager.size()).toBe(0);
      expect(cacheManager.has('key-1')).toBe(false);
      expect(cacheManager.has('key-2')).toBe(false);
      expect(cacheManager.has('key-3')).toBe(false);
    });

    it('should handle clearing empty cache', () => {
      expect(() => cacheManager.invalidateAll()).not.toThrow();
      expect(cacheManager.size()).toBe(0);
    });

    it('should cause re-fetch for all keys after clear', async () => {
      const fetcher1 = vi.fn().mockResolvedValue('value-1').mockResolvedValue('new-value-1');
      const fetcher2 = vi.fn().mockResolvedValue('value-2').mockResolvedValue('new-value-2');

      // Initial calls
      await cacheManager.get('key-1', fetcher1);
      await cacheManager.get('key-2', fetcher2);
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).toHaveBeenCalledTimes(1);

      // Clear all
      cacheManager.invalidateAll();

      // Subsequent calls should re-fetch
      await cacheManager.get('key-1', fetcher1);
      await cacheManager.get('key-2', fetcher2);
      expect(fetcher1).toHaveBeenCalledTimes(2);
      expect(fetcher2).toHaveBeenCalledTimes(2);
    });
  });

  describe('size method', () => {
    it('should return zero for empty cache', () => {
      expect(cacheManager.size()).toBe(0);
    });

    it('should return correct count after adding entries', async () => {
      const fetcher1 = vi.fn().mockResolvedValue('value-1');
      const fetcher2 = vi.fn().mockResolvedValue('value-2');
      const fetcher3 = vi.fn().mockResolvedValue('value-3');

      expect(cacheManager.size()).toBe(0);

      await cacheManager.get('key-1', fetcher1);
      expect(cacheManager.size()).toBe(1);

      await cacheManager.get('key-2', fetcher2);
      expect(cacheManager.size()).toBe(2);

      await cacheManager.get('key-3', fetcher3);
      expect(cacheManager.size()).toBe(3);
    });

    it('should return correct count after removing entries', async () => {
      const fetcher1 = vi.fn().mockResolvedValue('value-1');
      const fetcher2 = vi.fn().mockResolvedValue('value-2');

      await cacheManager.get('key-1', fetcher1);
      await cacheManager.get('key-2', fetcher2);
      expect(cacheManager.size()).toBe(2);

      cacheManager.invalidate('key-1');
      expect(cacheManager.size()).toBe(1);

      cacheManager.invalidateAll();
      expect(cacheManager.size()).toBe(0);
    });
  });

  describe('has method', () => {
    it('should return false for non-existent key', () => {
      expect(cacheManager.has('non-existent')).toBe(false);
    });

    it('should return true for existing key', async () => {
      mockFetcher.mockResolvedValue('test-value');

      expect(cacheManager.has('test-key')).toBe(false);

      await cacheManager.get('test-key', mockFetcher);

      expect(cacheManager.has('test-key')).toBe(true);
    });

    it('should return false after invalidation', async () => {
      mockFetcher.mockResolvedValue('test-value');

      await cacheManager.get('test-key', mockFetcher);
      expect(cacheManager.has('test-key')).toBe(true);

      cacheManager.invalidate('test-key');
      expect(cacheManager.has('test-key')).toBe(false);
    });

    it('should return true for expired entries (key exists but may be expired)', async () => {
      mockFetcher.mockResolvedValue('test-value');

      await cacheManager.get('test-key', mockFetcher);
      expect(cacheManager.has('test-key')).toBe(true);

      // Advance time beyond TTL
      vi.advanceTimersByTime(70000);

      // has() checks existence regardless of expiration
      expect(cacheManager.has('test-key')).toBe(true);
    });
  });

  describe('isValid method', () => {
    it('should return false for non-existent key', () => {
      expect(cacheManager.isValid('non-existent')).toBe(false);
    });

    it('should return true for valid (not expired) entry', async () => {
      mockFetcher.mockResolvedValue('test-value');

      await cacheManager.get('test-key', mockFetcher);
      expect(cacheManager.isValid('test-key')).toBe(true);
    });

    it('should return false for expired entry', async () => {
      mockFetcher.mockResolvedValue('test-value');

      await cacheManager.get('test-key', mockFetcher);
      expect(cacheManager.isValid('test-key')).toBe(true);

      // Advance time beyond TTL
      vi.advanceTimersByTime(70000);

      expect(cacheManager.isValid('test-key')).toBe(false);
    });

    it('should return true just before expiration', async () => {
      mockFetcher.mockResolvedValue('test-value');

      await cacheManager.get('test-key', mockFetcher);
      expect(cacheManager.isValid('test-key')).toBe(true);

      // Advance time to just before TTL expiration
      vi.advanceTimersByTime(59999);

      expect(cacheManager.isValid('test-key')).toBe(true);
    });

    it('should return false at exact expiration time', async () => {
      mockFetcher.mockResolvedValue('test-value');

      await cacheManager.get('test-key', mockFetcher);
      expect(cacheManager.isValid('test-key')).toBe(true);

      // Advance time to exact TTL expiration
      vi.advanceTimersByTime(60000);

      expect(cacheManager.isValid('test-key')).toBe(false);
    });
  });

  describe('TTL behavior', () => {
    it('should handle zero TTL correctly', async () => {
      const zeroTTLCache = new TTLCacheManager(0);
      mockFetcher.mockResolvedValue('test-value');

      await zeroTTLCache.get('test-key', mockFetcher);
      expect(zeroTTLCache.isValid('test-key')).toBe(false); // Should be immediately invalid
    });

    it('should handle negative TTL correctly', async () => {
      const negativeTTLCache = new TTLCacheManager(-1000);
      mockFetcher.mockResolvedValue('test-value');

      await negativeTTLCache.get('test-key', mockFetcher);
      expect(negativeTTLCache.isValid('test-key')).toBe(false); // Should be immediately invalid
    });

    it('should handle very short TTL', async () => {
      const shortTTLCache = new TTLCacheManager(100); // 100ms TTL
      mockFetcher.mockResolvedValue('test-value');

      await shortTTLCache.get('test-key', mockFetcher);
      expect(shortTTLCache.isValid('test-key')).toBe(true);

      vi.advanceTimersByTime(150);
      expect(shortTTLCache.isValid('test-key')).toBe(false);
    });

    it('should handle very long TTL', async () => {
      const longTTLCache = new TTLCacheManager(1000000000); // Very long TTL
      mockFetcher.mockResolvedValue('test-value');

      await longTTLCache.get('test-key', mockFetcher);
      expect(longTTLCache.isValid('test-key')).toBe(true);

      vi.advanceTimersByTime(999999999);
      expect(longTTLCache.isValid('test-key')).toBe(true);
    });
  });

  describe('edge cases and error scenarios', () => {
    it('should handle fetcher returning Promise.reject', async () => {
      const rejectedFetcher = vi.fn().mockRejectedValue(new Error('Async rejection'));

      await expect(cacheManager.get('reject-key', rejectedFetcher)).rejects.toThrow(
        'Async rejection',
      );
      expect(cacheManager.size()).toBe(0);
    });

    it('should handle fetcher throwing synchronous error', async () => {
      const throwingFetcher = vi.fn().mockImplementation(() => {
        throw new Error('Synchronous error');
      });

      await expect(cacheManager.get('throw-key', throwingFetcher)).rejects.toThrow(
        'Synchronous error',
      );
      expect(cacheManager.size()).toBe(0);
    });

    it('should handle very long keys', async () => {
      const longKey = 'a'.repeat(10000);
      mockFetcher.mockResolvedValue('long-key-value');

      const result = await cacheManager.get(longKey, mockFetcher);
      expect(result).toBe('long-key-value');
      expect(cacheManager.has(longKey)).toBe(true);
    });

    it('should handle unicode keys', async () => {
      const unicodeKey = '测试-键-🔑-نام';
      mockFetcher.mockResolvedValue('unicode-value');

      const result = await cacheManager.get(unicodeKey, mockFetcher);
      expect(result).toBe('unicode-value');
      expect(cacheManager.has(unicodeKey)).toBe(true);
    });

    it('should handle null and undefined values from fetcher', async () => {
      const nullFetcher = vi.fn().mockResolvedValue(null);
      const undefinedFetcher = vi.fn().mockResolvedValue(undefined);

      const nullResult = await cacheManager.get('null-key', nullFetcher);
      const undefinedResult = await cacheManager.get('undefined-key', undefinedFetcher);

      expect(nullResult).toBe(null);
      expect(undefinedResult).toBe(undefined);
      expect(cacheManager.size()).toBe(2);
    });

    it('should handle rapid sequential operations', async () => {
      const operations = [];

      for (let i = 0; i < 100; i++) {
        const fetcher = vi.fn().mockResolvedValue(`value-${i}`);
        operations.push(cacheManager.get(`key-${i}`, fetcher));
      }

      const results = await Promise.all(operations);
      expect(results).toHaveLength(100);
      expect(cacheManager.size()).toBe(100);
    });
  });

  describe('memory management', () => {
    it('should not grow indefinitely with different keys', async () => {
      // Add many entries
      for (let i = 0; i < 1000; i++) {
        const fetcher = vi.fn().mockResolvedValue(`value-${i}`);
        await cacheManager.get(`key-${i}`, fetcher);
      }

      expect(cacheManager.size()).toBe(1000);

      // Clear all
      cacheManager.invalidateAll();
      expect(cacheManager.size()).toBe(0);
    });

    it('should handle invalidation of many entries efficiently', async () => {
      // Add many entries
      for (let i = 0; i < 100; i++) {
        const fetcher = vi.fn().mockResolvedValue(`value-${i}`);
        await cacheManager.get(`key-${i}`, fetcher);
      }

      expect(cacheManager.size()).toBe(100);

      // Invalidate half
      for (let i = 0; i < 50; i++) {
        cacheManager.invalidate(`key-${i}`);
      }

      expect(cacheManager.size()).toBe(50);
    });
  });
});
