import { describe, expect, it, vi } from 'vitest';

import type { BaseRedisProvider } from './types';
import {
  buildIORedisSetArgs,
  claimRedisOnce,
  normalizeMsetValues,
  normalizeRedisKey,
  normalizeRedisKeys,
  readThroughRedis,
} from './utils';

const fakeRedis = (overrides: Partial<BaseRedisProvider> = {}) =>
  ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    ...overrides,
  }) as unknown as BaseRedisProvider;

describe('redis utils', () => {
  it('normalizes single redis key to string', () => {
    expect(normalizeRedisKey('foo')).toBe('foo');
    expect(normalizeRedisKey(Buffer.from('bar'))).toBe('bar');
  });

  it('normalizes an array of redis keys', () => {
    expect(normalizeRedisKeys(['foo', Buffer.from('bar')])).toEqual(['foo', 'bar']);
  });

  it('normalizes mset values from Map', () => {
    const payload = normalizeMsetValues(
      new Map<Buffer | string, number>([
        [Buffer.from('a'), 1],
        ['b', 2],
      ]),
    );

    expect(payload).toEqual({ a: 1, b: 2 });
  });

  it('builds ioredis set arguments', () => {
    const args = buildIORedisSetArgs({ ex: 1, nx: true, get: true });

    expect(args).toEqual(['EX', 1, 'NX', 'GET']);
  });
});

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

    await expect(claimRedisOnce(redis, 'claim', 45_000)).resolves.toBe(true);
    await expect(claimRedisOnce(redis, 'claim', 45_000)).resolves.toBe(false);

    expect(redis.set).toHaveBeenCalledWith('claim', '1', { nx: true, px: 45_000 });
  });

  it('grants the claim when there is no client to coordinate through', async () => {
    await expect(claimRedisOnce(null, 'claim', 1000)).resolves.toBe(true);
  });

  it('grants the claim when the SET NX command fails', async () => {
    // A memoized client can still have its commands rejected (e.g. Redis went
    // down). Coordination is best-effort: the caller must not be left with
    // "not the winner" and therefore do nothing.
    const redis = fakeRedis({
      set: vi.fn().mockRejectedValue(new Error('redis down')),
    });

    await expect(claimRedisOnce(redis, 'claim', 45_000)).resolves.toBe(true);
  });
});
