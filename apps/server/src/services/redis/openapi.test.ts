import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openapi } from './openapi';

const store = new Map<string, string>();
const redis = vi.hoisted(() => ({ client: null as any }));
vi.mock('./client', () => ({ getRedisServiceClient: async () => redis.client }));

// Mirrors the domain's Lua scripts: the rate-limit counter and the owned-claim write.
const evalScript = async (script: string, _keys: number, key: string, ...args: any[]) => {
  if (script.includes("'INCR'")) {
    const next = Number(store.get(key) ?? 0) + 1;
    store.set(key, String(next));
    return next;
  }
  const raw = store.get(key);
  const entry = raw ? JSON.parse(raw) : undefined;
  if (entry?.state !== 'pending' || entry.token !== args[0]) return 0;
  if (args[1] === 'del') store.delete(key);
  else store.set(key, args[1]);
  return 1;
};

const memoryClient = {
  del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  eval: vi.fn(evalScript),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
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
    expect(memoryClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("'INCR'"),
      1,
      `rate_limit:v1:key:k1:default:${windowStart}`,
      61,
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
    const claim = await openapi.claimIdempotency(scope);
    expect(claim).toEqual({ state: 'claimed', token: expect.any(String) });
    const { token } = claim as { token: string };
    expect(memoryClient.set).toHaveBeenCalledWith('idempotency:v1:u1:h1', expect.any(String), {
      ex: 300,
      nx: true,
    });
    expect(await openapi.claimIdempotency(scope)).toEqual({ sameRequest: true, state: 'pending' });

    const response = { body: '{"ok":true}', contentType: 'application/json', status: 201 };
    await openapi.completeIdempotency({ ...scope, token }, response);
    expect(memoryClient.eval).toHaveBeenLastCalledWith(
      expect.any(String),
      1,
      'idempotency:v1:u1:h1',
      token,
      expect.any(String),
      86_400,
    );

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
    const { token } = (await openapi.claimIdempotency(scope)) as { token: string };
    await openapi.releaseIdempotency({ ...scope, token });
    expect(await openapi.claimIdempotency(scope)).toMatchObject({ state: 'claimed' });
  });

  it('ignores a completion or release from a request that no longer owns the claim', async () => {
    await openapi.claimIdempotency(scope);
    await openapi.releaseIdempotency({ ...scope, token: 'stale' });
    await openapi.completeIdempotency(
      { ...scope, token: 'stale' },
      {
        body: 'x',
        contentType: null,
        status: 200,
      },
    );
    expect(await openapi.claimIdempotency(scope)).toEqual({ sameRequest: true, state: 'pending' });
  });

  it('answers undefined without Redis', async () => {
    redis.client = null;
    expect(await openapi.claimIdempotency(scope)).toBeUndefined();
  });
});
