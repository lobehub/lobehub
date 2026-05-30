import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRateLimiters, getRateLimiter, RateLimiter } from './rateLimiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    clearRateLimiters();
  });

  describe('constructor', () => {
    it('should initialize with full rpm tokens by default', () => {
      const limiter = new RateLimiter({ rpm: 10 });
      expect(limiter.availableRequestTokens).toBe(10);
    });

    it('should accept custom initialTokens', () => {
      const limiter = new RateLimiter({ initialTokens: 3, rpm: 10 });
      expect(limiter.availableRequestTokens).toBe(3);
    });

    it('should initialize tokenTokens to tpm when provided', () => {
      const limiter = new RateLimiter({ rpm: 10, tpm: 1000 });
      expect(limiter.availableTokenCapacity).toBe(1000);
    });

    it('should initialize tokenTokens to Infinity when tpm not provided', () => {
      const limiter = new RateLimiter({ rpm: 10 });
      expect(limiter.availableTokenCapacity).toBe(Infinity);
    });
  });

  describe('tryAcquire (RPM only)', () => {
    it('should return true and consume 1 request token', () => {
      const limiter = new RateLimiter({ rpm: 5 });
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.availableRequestTokens).toBe(4);
    });

    it('should return false when requestTokens < 1', () => {
      const limiter = new RateLimiter({ initialTokens: 0, rpm: 5 });
      expect(limiter.tryAcquire()).toBe(false);
    });

    it('should refill tokens proportionally to elapsed time', () => {
      const limiter = new RateLimiter({ initialTokens: 0, rpm: 60 });
      // After 1 second at 60 rpm, we should get 1 token (60/60 = 1 per second)
      vi.advanceTimersByTime(1000);
      expect(limiter.tryAcquire()).toBe(true);
    });

    it('should not exceed rpm capacity after refill', () => {
      const limiter = new RateLimiter({ rpm: 10 });
      // Even after waiting a long time, tokens should cap at rpm
      vi.advanceTimersByTime(120_000); // 2 minutes
      expect(limiter.availableRequestTokens).toBe(10);
    });

    it('should handle rapid successive acquires', () => {
      const limiter = new RateLimiter({ rpm: 3 });
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
    });
  });

  describe('tryAcquire (RPM + TPM)', () => {
    it('should consume both request and token tokens', () => {
      const limiter = new RateLimiter({ rpm: 10, tpm: 1000 });
      expect(limiter.tryAcquire(100)).toBe(true);
      expect(limiter.availableRequestTokens).toBe(9);
      expect(limiter.availableTokenCapacity).toBe(900);
    });

    it('should return false when tokenTokens < tokenCount', () => {
      const limiter = new RateLimiter({ rpm: 10, tpm: 100 });
      expect(limiter.tryAcquire(200)).toBe(false);
    });

    it('should not consume tokens when tokenCount is undefined', () => {
      const limiter = new RateLimiter({ rpm: 10, tpm: 100 });
      limiter.tryAcquire();
      expect(limiter.availableTokenCapacity).toBe(100);
    });

    it('should not consume tokens when tokenCount is 0', () => {
      const limiter = new RateLimiter({ rpm: 10, tpm: 100 });
      limiter.tryAcquire(0);
      expect(limiter.availableTokenCapacity).toBe(100);
    });
  });

  describe('acquire (blocking, RPM only)', () => {
    it('should resolve immediately when tokens available', async () => {
      const limiter = new RateLimiter({ rpm: 10 });
      await limiter.acquire();
      expect(limiter.availableRequestTokens).toBe(9);
    });

    it('should block and wait when no tokens available', async () => {
      const limiter = new RateLimiter({ rpm: 60, initialTokens: 0 });
      const acquirePromise = limiter.acquire();

      // Should not resolve immediately
      let resolved = false;
      acquirePromise.then(() => {
        resolved = true;
      });

      // Not yet resolved (need ~1000ms for 1 token at 60rpm)
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);

      // Advance past the wait time
      await vi.advanceTimersByTimeAsync(1100);
      expect(resolved).toBe(true);
    });

    it('should refill tokens proportionally to elapsed time', async () => {
      const limiter = new RateLimiter({ rpm: 60 });
      await limiter.acquire();
      // Started with 60, consumed 1 = 59
      expect(limiter.availableRequestTokens).toBe(59);

      // After 1 second, 1 token should be refilled (60 rpm = 1 per second)
      vi.advanceTimersByTime(1000);
      expect(limiter.availableRequestTokens).toBe(60);
    });
  });

  describe('acquire (blocking, RPM + TPM)', () => {
    it('should wait for token capacity when TPM exceeded', async () => {
      const limiter = new RateLimiter({ rpm: 60, tpm: 100 });
      // Consume all token capacity
      limiter.tryAcquire(100);
      expect(limiter.availableTokenCapacity).toBe(0);

      const acquirePromise = limiter.acquire(100);
      let resolved = false;
      acquirePromise.then(() => {
        resolved = true;
      });

      // Not yet resolved
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);

      // Advance past the wait time for 100 tokens at 100 tpm = 60 seconds
      await vi.advanceTimersByTimeAsync(61_000);
      expect(resolved).toBe(true);
    });
  });

  describe('refill edge cases', () => {
    it('should handle elapsedMs <= 0 (no-op)', () => {
      const limiter = new RateLimiter({ rpm: 10 });
      const initial = limiter.availableRequestTokens;
      // No time has passed
      expect(limiter.availableRequestTokens).toBe(initial);
    });

    it('should cap tokens at rpm maximum', () => {
      const limiter = new RateLimiter({ rpm: 10 });
      limiter.tryAcquire(); // 9 tokens
      // Wait long enough to refill more than 1 token
      vi.advanceTimersByTime(120_000); // 2 minutes
      // Should be capped at 10
      expect(limiter.availableRequestTokens).toBe(10);
    });

    it('should cap token tokens at tpm maximum', () => {
      const limiter = new RateLimiter({ rpm: 10, tpm: 500 });
      limiter.tryAcquire(100); // 400 remaining
      // Wait long enough to refill more than 100 tokens
      vi.advanceTimersByTime(120_000); // 2 minutes
      // Should be capped at 500
      expect(limiter.availableTokenCapacity).toBe(500);
    });
  });

  describe('availableRequestTokens', () => {
    it('should return floored request tokens after refill', () => {
      const limiter = new RateLimiter({ initialTokens: 0, rpm: 60 });
      // After 500ms, we have 0.5 tokens, floor = 0
      vi.advanceTimersByTime(500);
      expect(limiter.availableRequestTokens).toBe(0);

      // After 1s total, we have 1.0 token, floor = 1
      vi.advanceTimersByTime(500);
      expect(limiter.availableRequestTokens).toBe(1);
    });
  });

  describe('availableTokenCapacity', () => {
    it('should return Infinity when tpm not configured', () => {
      const limiter = new RateLimiter({ rpm: 10 });
      expect(limiter.availableTokenCapacity).toBe(Infinity);
    });

    it('should return floored token capacity when tpm configured', () => {
      const limiter = new RateLimiter({ rpm: 10, tpm: 1000 });
      expect(limiter.availableTokenCapacity).toBe(1000);
    });
  });

  describe('concurrent acquire', () => {
    it('should handle concurrent acquire with sufficient tokens', async () => {
      const limiter = new RateLimiter({ rpm: 10 });
      const results: number[] = [];

      const acquireAndRecord = async (id: number) => {
        await limiter.acquire();
        results.push(id);
      };

      const promises = [acquireAndRecord(1), acquireAndRecord(2), acquireAndRecord(3), acquireAndRecord(4)];

      await vi.advanceTimersByTimeAsync(0);
      await Promise.all(promises);

      expect(results).toHaveLength(4);
      expect(limiter.availableRequestTokens).toBe(6);
    });

    it('should handle concurrent acquire with limited tokens', async () => {
      const limiter = new RateLimiter({ rpm: 2 });
      const results: number[] = [];

      const acquireAndRecord = async (id: number) => {
        await limiter.acquire();
        results.push(id);
      };

      const promises = [acquireAndRecord(1), acquireAndRecord(2), acquireAndRecord(3), acquireAndRecord(4)];

      // First 2 should succeed immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(results).toHaveLength(2);

      // After enough time for refill, remaining should succeed
      await vi.advanceTimersByTimeAsync(90_000);
      await Promise.all(promises);
      expect(results).toHaveLength(4);
    });

    it('should respect RPM limit under concurrent acquire', async () => {
      const limiter = new RateLimiter({ rpm: 2 });
      const results: number[] = [];

      const acquireAndRecord = async (id: number) => {
        await limiter.acquire();
        results.push(id);
      };

      const promises = [acquireAndRecord(1), acquireAndRecord(2), acquireAndRecord(3), acquireAndRecord(4)];

      // First 2 proceed immediately, others block
      await vi.advanceTimersByTimeAsync(0);
      expect(results).toHaveLength(2);

      // Blocked callers should not resolve within the RPM wait window
      await vi.advanceTimersByTimeAsync(29_999);
      expect(results).toHaveLength(2);

      // After enough refill cycles, all should complete
      await vi.advanceTimersByTimeAsync(90_000);
      await Promise.all(promises);
      expect(results).toHaveLength(4);
    });

    it('should use longer wait when both RPM and TPM exhausted', async () => {
      // TPM wait (60s) > RPM wait (30s), so TPM should dominate
      const limiter = new RateLimiter({ rpm: 2, tpm: 100 });
      const results: number[] = [];

      // Exhaust both limits
      limiter.tryAcquire(100);
      expect(limiter.availableRequestTokens).toBe(1);
      limiter.tryAcquire();
      expect(limiter.availableRequestTokens).toBe(0);
      expect(limiter.availableTokenCapacity).toBe(0);

      const acquireAndRecord = async (id: number) => {
        await limiter.acquire(100);
        results.push(id);
      };

      const promises = [acquireAndRecord(1), acquireAndRecord(2)];

      await vi.advanceTimersByTimeAsync(0);
      expect(results).toHaveLength(0);

      // RPM would refill in 30s but TPM needs 60s - should not resolve at 30s
      await vi.advanceTimersByTimeAsync(30_000);
      expect(results).toHaveLength(0);

      // After enough time for TPM refill, all should complete
      await vi.advanceTimersByTimeAsync(90_000);
      await Promise.all(promises);
      expect(results).toHaveLength(2);
    });

    it('should not starve any caller under contention', async () => {
      const limiter = new RateLimiter({ rpm: 1 });
      const results: number[] = [];
      const callerCount = 6;

      const acquireAndRecord = async (id: number) => {
        await limiter.acquire();
        results.push(id);
      };

      const promises = Array.from({ length: callerCount }, (_, i) => acquireAndRecord(i + 1));

      // Only first caller succeeds immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(results).toHaveLength(1);

      // Advance enough time for all remaining callers (60s each at 1 rpm)
      await vi.advanceTimersByTimeAsync(60_000 * callerCount);
      await Promise.all(promises);

      expect(results).toHaveLength(callerCount);
      expect(results.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });
});

describe('getRateLimiter (registry)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    clearRateLimiters();
  });

  it('should create new limiter on first call with options', () => {
    const limiter = getRateLimiter('openai', { rpm: 10 });
    expect(limiter).toBeInstanceOf(RateLimiter);
  });

  it('should return existing limiter on subsequent calls (same key)', () => {
    const limiter1 = getRateLimiter('openai', { rpm: 10 });
    const limiter2 = getRateLimiter('openai', { rpm: 20 });
    expect(limiter1).toBe(limiter2);
  });

  it('should return null when no options and key not found', () => {
    const limiter = getRateLimiter('nonexistent');
    expect(limiter).toBeNull();
  });

  it('should not overwrite existing limiter with new options', () => {
    const limiter1 = getRateLimiter('openai', { rpm: 10 });
    const limiter2 = getRateLimiter('openai', { rpm: 999 });
    expect(limiter1).toBe(limiter2);
    // Verify the original rpm was kept
    expect(limiter1!.availableRequestTokens).toBe(10);
  });

  it('should support different keys for different providers', () => {
    const openai = getRateLimiter('openai', { rpm: 10 });
    const anthropic = getRateLimiter('anthropic', { rpm: 20 });
    expect(openai).not.toBe(anthropic);
  });

  it('should return existing limiter when calling with options on existing key', () => {
    getRateLimiter('openai', { rpm: 10 });
    const limiter = getRateLimiter('openai');
    expect(limiter).toBeInstanceOf(RateLimiter);
  });
});

describe('clearRateLimiters', () => {
  it('should remove all registered limiters', () => {
    getRateLimiter('openai', { rpm: 10 });
    getRateLimiter('anthropic', { rpm: 20 });
    clearRateLimiters();
    expect(getRateLimiter('openai')).toBeNull();
    expect(getRateLimiter('anthropic')).toBeNull();
  });
});
