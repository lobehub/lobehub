// @vitest-environment node
import type IORedisClient from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { openapi } from './openapi';

/**
 * Runs the openapi Lua scripts against a real Redis. Skipped unless
 * `OPENAPI_REAL_REDIS_URL` points at a disposable instance:
 *
 *   docker run -d -p 127.0.0.1:6391:6379 redis:7-alpine
 *   OPENAPI_REAL_REDIS_URL=redis://127.0.0.1:6391 vitest run apps/server/src/services/redis/openapi.realRedis.test.ts
 */
const url = process.env.OPENAPI_REAL_REDIS_URL;

describe.skipIf(!url)('openapi redis domain (real Redis)', () => {
  const prefix = `openapi-test-${Date.now()}`;
  let domain: typeof openapi;
  let raw: IORedisClient;

  beforeAll(async () => {
    vi.resetModules();
    process.env.REDIS_URL = url;
    process.env.REDIS_PREFIX = prefix;
    domain = (await import('./openapi')).openapi;
    const { default: IORedis } = await import('ioredis');
    raw = new IORedis(url!);
  });

  afterAll(async () => {
    const keys = await raw.keys(`${prefix}:*`);
    if (keys.length > 0) await raw.del(...keys);
    raw.disconnect();
  });

  it('counts a window atomically and gives it an expiry on the first hit', async () => {
    const scope = { bucket: 'b', identity: 'key:k1', limit: 2, windowSeconds: 60 };
    expect(await domain.hitRateLimit(scope)).toMatchObject({ allowed: true, remaining: 1 });
    expect(await domain.hitRateLimit(scope)).toMatchObject({ allowed: true, remaining: 0 });
    expect(await domain.hitRateLimit(scope)).toMatchObject({ allowed: false, remaining: 0 });

    const [key] = await raw.keys(`${prefix}:openapi:rate_limit:v1:key:k1:b:*`);
    expect(await raw.get(key)).toBe('3');
    expect(await raw.ttl(key)).toBeGreaterThan(0);
  });

  it('only lets the claim owner complete or release a key', async () => {
    const scope = { fingerprint: 'f', keyHash: 'h1', userId: 'u1' };
    const claim = await domain.claimIdempotency(scope);
    expect(claim).toMatchObject({ state: 'claimed' });
    const token = (claim as { token: string }).token;

    // A stale owner (its claim expired and a retry took the key) writes nothing.
    await domain.releaseIdempotency({ ...scope, token: 'stale' });
    await domain.completeIdempotency(
      { ...scope, token: 'stale' },
      {
        body: 'stale',
        contentType: null,
        status: 200,
      },
    );
    expect(await domain.claimIdempotency(scope)).toEqual({ sameRequest: true, state: 'pending' });

    const response = { body: '{"ok":true}', contentType: 'application/json', status: 201 };
    await domain.completeIdempotency({ ...scope, token }, response);
    expect(await domain.claimIdempotency(scope)).toEqual({
      response,
      sameRequest: true,
      state: 'completed',
    });
    const [key] = await raw.keys(`${prefix}:openapi:idempotency:v1:u1:h1`);
    expect(await raw.ttl(key)).toBeGreaterThan(86_000);

    // A completed record is no longer a claim: releasing it is a no-op.
    await domain.releaseIdempotency({ ...scope, token });
    expect(await domain.claimIdempotency(scope)).toMatchObject({ state: 'completed' });
  });
});
