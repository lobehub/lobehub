import { beforeEach, describe, expect, it, vi } from 'vitest';

import { claimOnce, readThrough } from '../readThroughCache';

const { redis, getClient } = vi.hoisted(() => {
  const redis = { get: vi.fn(), set: vi.fn() };
  return { getClient: vi.fn(() => redis as any), redis };
});

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: getClient,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getClient.mockReturnValue(redis as any);
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue('OK');
});

describe('readThrough', () => {
  it('serves a cached answer without calling read', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ tools: ['a'] }));
    const read = vi.fn();

    await expect(readThrough('k', read, { ttlMs: 1000 })).resolves.toEqual({ tools: ['a'] });

    expect(read).not.toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalledWith('send_path_cache:k');
  });

  it('reads live on a miss and writes the answer back with the TTL', async () => {
    const read = vi.fn().mockResolvedValue({ arch: 'arm64' });

    await expect(readThrough('k', read, { ttlMs: 1234 })).resolves.toEqual({ arch: 'arm64' });

    expect(read).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'send_path_cache:k',
      JSON.stringify({ arch: 'arm64' }),
      'PX',
      1234,
    );
  });

  it('does not remember an undefined answer or one the caller rejects', async () => {
    await readThrough('k', async () => undefined, { ttlMs: 1000 });
    await readThrough('k', async () => ({ tools: [] }), {
      shouldCache: (value) => value.tools.length > 0,
      ttlMs: 1000,
    });

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falls through to the live read when Redis is unavailable or failing', async () => {
    getClient.mockReturnValue(null);
    await expect(readThrough('k', async () => 1, { ttlMs: 1000 })).resolves.toBe(1);

    getClient.mockReturnValue(redis as any);
    redis.get.mockRejectedValue(new Error('ECONNRESET'));
    await expect(readThrough('k', async () => 2, { ttlMs: 1000 })).resolves.toBe(2);
  });

  it('does not cache a live read that rejects', async () => {
    await expect(
      readThrough(
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

describe('claimOnce', () => {
  it('claims through Redis SET NX and reports whether this caller won', async () => {
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await expect(claimOnce('rescan:dev-1', 45_000)).resolves.toBe(true);
    await expect(claimOnce('rescan:dev-1', 45_000)).resolves.toBe(false);

    expect(redis.set).toHaveBeenCalledWith(
      'send_path_cache:claim:rescan:dev-1',
      '1',
      'PX',
      45_000,
      'NX',
    );
  });

  it('falls back to a per-process claim without Redis, and lets it expire', async () => {
    getClient.mockReturnValue(null);
    vi.useFakeTimers();
    try {
      await expect(claimOnce('rescan:dev-2', 1000)).resolves.toBe(true);
      await expect(claimOnce('rescan:dev-2', 1000)).resolves.toBe(false);
      vi.advanceTimersByTime(1001);
      await expect(claimOnce('rescan:dev-2', 1000)).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
