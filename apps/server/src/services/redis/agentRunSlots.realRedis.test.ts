// @vitest-environment node
import type IORedisClient from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { agentRunSlots } from './agentRunSlots';

/**
 * Runs the run-slot Lua scripts against a real Redis. Skipped unless
 * `AGENT_RUN_SLOTS_REAL_REDIS_URL` points at a disposable instance:
 *
 *   docker run -d -p 127.0.0.1:6391:6379 redis:7-alpine
 *   AGENT_RUN_SLOTS_REAL_REDIS_URL=redis://127.0.0.1:6391 vitest run apps/server/src/services/redis/agentRunSlots.realRedis.test.ts
 */
const url = process.env.AGENT_RUN_SLOTS_REAL_REDIS_URL;

describe.skipIf(!url)('agentRunSlots redis domain (real Redis)', () => {
  const prefix = `agent-run-slots-test-${Date.now()}`;
  const ttlMs = 60_000;
  let domain: typeof agentRunSlots;
  let raw: IORedisClient;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    vi.resetModules();
    process.env.REDIS_URL = url;
    process.env.REDIS_PREFIX = prefix;
    domain = (await import('./agentRunSlots')).agentRunSlots;
    const { default: IORedis } = await import('ioredis');
    raw = new IORedis(url!);
    cleanup = async () => {
      const keys = await raw.keys(`${prefix}:*`);
      if (keys.length > 0) await raw.del(...keys);
      raw.disconnect();
    };
  });

  afterAll(async () => {
    await cleanup?.();
  });

  const slotsKey = (userId: string) => `${prefix}:agentRun:run_slots:v1:${userId}`;

  it('refuses the run past the limit and admits it again once a slot is released', async () => {
    expect(await domain.acquire('u1', 'op-a', { limit: 2, ttlMs })).toEqual({
      inFlight: 1,
      status: 'acquired',
    });
    expect(await domain.acquire('u1', 'op-b', { limit: 2, ttlMs })).toEqual({
      inFlight: 2,
      status: 'acquired',
    });
    expect(await domain.acquire('u1', 'op-c', { limit: 2, ttlMs })).toEqual({
      inFlight: 2,
      status: 'full',
    });

    await domain.release('u1', 'op-a');
    expect(await domain.acquire('u1', 'op-c', { limit: 2, ttlMs })).toEqual({
      inFlight: 2,
      status: 'acquired',
    });
  });

  it('treats a repeated acquire by the same holder as one slot', async () => {
    await domain.acquire('u2', 'op-a', { limit: 1, ttlMs });
    expect(await domain.acquire('u2', 'op-a', { limit: 1, ttlMs })).toEqual({
      inFlight: 1,
      status: 'acquired',
    });
    expect(await raw.hlen(slotsKey('u2'))).toBe(1);
  });

  it('drops a lapsed lease before counting', async () => {
    await raw.hset(slotsKey('u3'), 'op-stale', String(Date.now() - 1));
    expect(await domain.acquire('u3', 'op-new', { limit: 1, ttlMs })).toEqual({
      inFlight: 1,
      status: 'acquired',
    });
    expect(await raw.hexists(slotsKey('u3'), 'op-stale')).toBe(0);
  });

  it('counts an unchecked lease without refusing it', async () => {
    await domain.acquire('u4', 'op-a', { limit: 1, ttlMs });
    expect(await domain.acquire('u4', 'op-resume', { limit: null, ttlMs })).toEqual({
      inFlight: 2,
      status: 'acquired',
    });
    expect(await domain.acquire('u4', 'op-c', { limit: 2, ttlMs })).toEqual({
      inFlight: 2,
      status: 'full',
    });
  });

  it('renews only a live lease and moves a provisional lease to the real id', async () => {
    await domain.renew('u5', 'op-missing', ttlMs);
    expect(await raw.exists(slotsKey('u5'))).toBe(0);

    await domain.acquire('u5', 'pending-1', { limit: 1, ttlMs });
    await domain.rebind('u5', 'pending-1', 'op-real', ttlMs);
    expect(await raw.hkeys(slotsKey('u5'))).toEqual(['op-real']);

    const before = Number(await raw.hget(slotsKey('u5'), 'op-real'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await domain.renew('u5', 'op-real', ttlMs);
    expect(Number(await raw.hget(slotsKey('u5'), 'op-real'))).toBeGreaterThan(before);
    expect(await raw.pttl(slotsKey('u5'))).toBeGreaterThan(ttlMs - 5000);
  });
});
