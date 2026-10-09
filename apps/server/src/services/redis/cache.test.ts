import { describe, expect, it, vi } from 'vitest';

import type { BaseRedisProvider } from '@/server/modules/Redis/types';

import { claimRedisOnce, readThroughRedis } from './cache';

const fakeRedis = (overrides: Partial<BaseRedisProvider> = {}) =>
  ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    ...overrides,
  }) as unknown as BaseRedisProvider;

describe('readThroughRedis', () => {
  it('serves a remembered answer without calling read', async () => {
    const redis = fakeRedis({ get: vi.fn(async () => JSON.stringify({ tools: ['a'] })) });
    const read = vi.fn();

    await expect(readThroughRedis(redis, 'k', read, { ttlMs: 1000 })).resolves.toEqual({
      tools: ['a'],
    });

    expect(read).not.toHaveBeenCalled();
  });

  it('reads live on a miss and writes the answer back with the TTL', async () => {
    const redis = fakeRedis();
    const read = vi.fn(async () => ({ arch: 'arm64' }));

    await expect(readThroughRedis(redis, 'k', read, { ttlMs: 1234 })).resolves.toEqual({
      arch: 'arm64',
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('k', JSON.stringify({ arch: 'arm64' }), { px: 1234 });
  });

  it('does not remember an undefined answer or one the caller rejects', async () => {
    const redis = fakeRedis();

    await readThroughRedis(redis, 'k', async () => undefined, { ttlMs: 1000 });
    await readThroughRedis(redis, 'k', async () => ({ tools: [] as string[] }), {
      shouldCache: (value) => value.tools.length > 0,
      ttlMs: 1000,
    });

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falls through to the live read without a client or when Redis fails', async () => {
    await expect(readThroughRedis(null, 'k', async () => 1, { ttlMs: 1000 })).resolves.toBe(1);

    const failing = fakeRedis({
      get: vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    });
    await expect(readThroughRedis(failing, 'k', async () => 2, { ttlMs: 1000 })).resolves.toBe(2);
  });

  it('does not remember a live read that rejects', async () => {
    const redis = fakeRedis();

    await expect(
      readThroughRedis(
        redis,
        'k',
        async () => {
          throw new Error('upstream');
        },
        { ttlMs: 1000 },
      ),
    ).rejects.toThrow('upstream');

    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('claimRedisOnce', () => {
  it('claims with SET NX and reports whether this caller won', async () => {
    const redis = fakeRedis({
      set: vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
    });

    await expect(claimRedisOnce(redis, 'claim-win', 45_000)).resolves.toBe(true);
    await expect(claimRedisOnce(redis, 'claim-win', 45_000)).resolves.toBe(false);

    expect(redis.set).toHaveBeenCalledWith('claim-win', '1', { nx: true, px: 45_000 });
  });

  it('coalesces concurrent callers with a process-local claim when Redis is absent', async () => {
    await expect(claimRedisOnce(null, 'claim-local', 45_000)).resolves.toBe(true);
    await expect(claimRedisOnce(null, 'claim-local', 45_000)).resolves.toBe(false);
  });

  it('falls back to a process-local claim when the SET NX command fails', async () => {
    // A memoized client can still reject commands (Redis went down). Rather
    // than let every caller proceed, keep the in-process coalescing.
    const redis = fakeRedis({ set: vi.fn().mockRejectedValue(new Error('redis down')) });

    await expect(claimRedisOnce(redis, 'claim-fallback', 45_000)).resolves.toBe(true);
    await expect(claimRedisOnce(redis, 'claim-fallback', 45_000)).resolves.toBe(false);
  });
});
