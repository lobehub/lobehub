import { beforeEach, describe, expect, it, vi } from 'vitest';

import { abortableRequest } from './abortableRequest';

describe('AbortableRequestManager', () => {
  beforeEach(() => {
    abortableRequest.cancelAll();
  });

  describe('execute', () => {
    it('should execute request successfully', async () => {
      const mockFetcher = vi.fn(async (signal: AbortSignal) => {
        return 'result';
      });

      const result = await abortableRequest.execute('test-key', mockFetcher);

      expect(result).toBe('result');
      expect(mockFetcher).toHaveBeenCalledTimes(1);
      expect(mockFetcher).toHaveBeenCalledWith(expect.any(AbortSignal));
    });

    it('should cancel previous request when new request with same key is triggered', async () => {
      let firstRequestAborted = false;
      let secondRequestAborted = false;

      const firstFetcher = vi.fn(
        async (signal: AbortSignal) =>
          new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              firstRequestAborted = true;
              reject(new Error('Aborted'));
            });
            setTimeout(() => resolve('first'), 100);
          }),
      );

      const secondFetcher = vi.fn(
        async (signal: AbortSignal) =>
          new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              secondRequestAborted = true;
              reject(new Error('Aborted'));
            });
            setTimeout(() => resolve('second'), 100);
          }),
      );

      // Start first request
      const firstPromise = abortableRequest.execute('same-key', firstFetcher);

      // Start second request with same key (should cancel first)
      await new Promise((resolve) => setTimeout(resolve, 10));
      const secondPromise = abortableRequest.execute('same-key', secondFetcher);

      // First should be aborted
      await expect(firstPromise).rejects.toThrow('Aborted');
      expect(firstRequestAborted).toBe(true);

      // Second should succeed
      const result = await secondPromise;
      expect(result).toBe('second');
      expect(secondRequestAborted).toBe(false);
    });

    it('should allow concurrent requests with different keys', async () => {
      const fetcher1 = vi.fn(async () => 'result1');
      const fetcher2 = vi.fn(async () => 'result2');

      const [result1, result2] = await Promise.all([
        abortableRequest.execute('key1', fetcher1),
        abortableRequest.execute('key2', fetcher2),
      ]);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).toHaveBeenCalledTimes(1);
    });

    it('should clean up controller after request completes', async () => {
      const fetcher = vi.fn(async () => 'result');

      await abortableRequest.execute('cleanup-test', fetcher);

      // Manually check that controller is cleaned up by starting a new request
      // and verifying it doesn't abort anything (since map should be empty)
      let aborted = false;
      const fetcher2 = vi.fn(
        async (signal: AbortSignal) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              aborted = true;
            });
            setTimeout(() => resolve('result2'), 50);
          }),
      );

      await abortableRequest.execute('cleanup-test', fetcher2);
      expect(aborted).toBe(false);
    });
  });

  describe('cancel', () => {
    it('should cancel specific request by key', async () => {
      let aborted = false;
      const fetcher = vi.fn(
        async (signal: AbortSignal) =>
          new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('Cancelled'));
            });
            setTimeout(() => resolve('result'), 100);
          }),
      );

      const promise = abortableRequest.execute('cancel-key', fetcher);

      await new Promise((resolve) => setTimeout(resolve, 10));
      abortableRequest.cancel('cancel-key');

      await expect(promise).rejects.toThrow('Cancelled');
      expect(aborted).toBe(true);
    });

    it('should do nothing when canceling non-existent key', () => {
      expect(() => abortableRequest.cancel('non-existent')).not.toThrow();
    });
  });

  describe('cancelAll', () => {
    it('should cancel all pending requests', async () => {
      const results = { req1: false, req2: false, req3: false };

      const createFetcher = (key: keyof typeof results) =>
        vi.fn(
          async (signal: AbortSignal) =>
            new Promise((resolve, reject) => {
              signal.addEventListener('abort', () => {
                results[key] = true;
                reject(new Error('Cancelled'));
              });
              setTimeout(() => resolve(`result-${key}`), 100);
            }),
        );

      const promise1 = abortableRequest.execute('key1', createFetcher('req1'));
      const promise2 = abortableRequest.execute('key2', createFetcher('req2'));
      const promise3 = abortableRequest.execute('key3', createFetcher('req3'));

      await new Promise((resolve) => setTimeout(resolve, 10));
      abortableRequest.cancelAll();

      await expect(Promise.all([promise1, promise2, promise3])).rejects.toThrow();
      expect(results.req1).toBe(true);
      expect(results.req2).toBe(true);
      expect(results.req3).toBe(true);
    });
  });
});
