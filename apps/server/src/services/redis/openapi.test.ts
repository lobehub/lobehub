import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openapi } from './openapi';

const store = new Map<string, string>();
const redis = vi.hoisted(() => ({ client: null as any }));
vi.mock('./client', () => ({ getRedisServiceClient: async () => redis.client }));

const memoryClient = {
  del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  incr: vi.fn(async (key: string) => {
    const next = Number(store.get(key) ?? 0) + 1;
    store.set(key, String(next));
    return next;
  }),
  set: vi.fn(async (key: string, value: string, options?: { nx?: boolean }) => {
    if (options?.nx && store.has(key)) return null;
    store.set(key, value);
    return 'OK';
  }),
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redis.client = memoryClient;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T10:00:30Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const windowStart = Math.floor(new Date('2026-11-17T10:00:00Z').getTime() / 1000);

describe('redisService.openapi.hitRateLimit', () => {
  const scope = { bucket: 'default', identity: 'key:k1', limit: 2, windowSeconds: 60 };

  it('counts requests in an epoch-aligned window and refuses past the limit', async () => {
    expect(await openapi.hitRateLimit(scope)).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAt: windowStart + 60,
    });
    expect(memoryClient.set).toHaveBeenCalledWith(
      `rate_limit:v1:key:k1:default:${windowStart}`,
      '0',
      { ex: 61, nx: true },
    );
    expect((await openapi.hitRateLimit(scope))?.remaining).toBe(0);
    expect(await openapi.hitRateLimit(scope)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('starts a fresh window once the current one ends', async () => {
    await openapi.hitRateLimit(scope);
    await openapi.hitRateLimit(scope);
    vi.setSystemTime(new Date('2026-11-17T10:01:00Z'));
    expect(await openapi.hitRateLimit(scope)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('answers undefined without Redis so the caller can fail open', async () => {
    redis.client = null;
    expect(await openapi.hitRateLimit(scope)).toBeUndefined();
  });
});

describe('redisService.openapi idempotency', () => {
  const scope = { fingerprint: 'f1', keyHash: 'h1', userId: 'u1' };

  it('claims a key once, then replays the stored first response for the same request', async () => {
    expect(await openapi.claimIdempotency(scope)).toEqual({ state: 'claimed' });
    expect(memoryClient.set).toHaveBeenCalledWith('idempotency:v1:u1:h1', expect.any(String), {
      ex: 300,
      nx: true,
    });
    expect(await openapi.claimIdempotency(scope)).toEqual({ sameRequest: true, state: 'pending' });

    const response = { body: '{"ok":true}', contentType: 'application/json', status: 201 };
    await openapi.completeIdempotency(scope, response);
    expect(memoryClient.set).toHaveBeenLastCalledWith('idempotency:v1:u1:h1', expect.any(String), {
      ex: 86_400,
    });

    expect(await openapi.claimIdempotency(scope)).toEqual({
      response,
      sameRequest: true,
      state: 'completed',
    });
    expect(await openapi.claimIdempotency({ ...scope, fingerprint: 'other' })).toMatchObject({
      sameRequest: false,
      state: 'completed',
    });
  });

  it('frees a released claim for a retry', async () => {
    await openapi.claimIdempotency(scope);
    await openapi.releaseIdempotency(scope);
    expect(await openapi.claimIdempotency(scope)).toEqual({ state: 'claimed' });
  });

  it('answers undefined without Redis', async () => {
    redis.client = null;
    expect(await openapi.claimIdempotency(scope)).toBeUndefined();
  });
});
