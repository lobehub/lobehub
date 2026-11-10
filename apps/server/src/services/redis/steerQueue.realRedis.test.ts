// @vitest-environment node
import type IORedisClient from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { steerQueue as SteerQueue } from './steerQueue';

/**
 * Runs the steer queue's lease renewal and the heterogeneous delivery records
 * against a real Redis. Skipped unless `STEER_QUEUE_REAL_REDIS_URL` points at a
 * disposable instance:
 *
 *   docker run -d -p 127.0.0.1:6392:6379 redis:7-alpine
 *   STEER_QUEUE_REAL_REDIS_URL=redis://127.0.0.1:6392 vitest run apps/server/src/services/redis/steerQueue.realRedis.test.ts
 */
const url = process.env.STEER_QUEUE_REAL_REDIS_URL;

describe.skipIf(!url)('steerQueue lease renewal and hetero deliveries (real Redis)', () => {
  const prefix = `steer-queue-test-${Date.now()}`;
  const scope = { threadId: null, topicId: 'tpc-1', userId: 'user-1' };
  let queue: typeof SteerQueue;
  let raw: IORedisClient;

  beforeAll(async () => {
    vi.resetModules();
    process.env.REDIS_URL = url;
    process.env.REDIS_PREFIX = prefix;
    queue = (await import('./steerQueue')).steerQueue;
    const { default: IORedis } = await import('ioredis');
    raw = new IORedis(url!);
  });

  afterAll(async () => {
    const keys = await raw.keys(`${prefix}:*`);
    if (keys.length > 0) await raw.del(...keys);
    raw.disconnect();
  });

  const drainedKey = `${prefix}:agentSteer:follow_ups_drained:v1:user-1:tpc-1:main`;
  const expiryOf = async (drainId: string) => {
    const batch = await raw.hget(drainedKey, drainId);
    return Number(batch!.split(String.fromCharCode(30))[0]);
  };

  it('extends a drained batch lease without touching its entries', async () => {
    await queue.append(scope, { createdAt: 1, id: 'e1' }, 'op-1');
    const drained = await queue.drain(scope, 'op-1', [], 'drain-1');
    expect(drained.map((entry) => entry.id)).toEqual(['e1']);

    const before = await expiryOf('drain-1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await queue.renew(scope, 'drain-1')).toBe(true);
    expect(await expiryOf('drain-1')).toBeGreaterThan(before);

    // Still the same batch: settling it acknowledges the entry.
    await queue.settle(scope, 'drain-1');
    expect(await raw.hget(drainedKey, 'drain-1')).toBeNull();
    expect(await queue.renew(scope, 'drain-1')).toBe(false);
  });

  it('keeps delivery records per run until they are removed', async () => {
    await queue.putHeteroDelivery('op-1', 'msg-1', { drainId: 'd1', entryId: 'e1' });
    await queue.putHeteroDelivery('op-1', 'msg-2', { drainId: 'd2', entryId: 'e2' });

    expect(await queue.listHeteroDeliveries('op-1')).toEqual({
      'msg-1': { drainId: 'd1', entryId: 'e1' },
      'msg-2': { drainId: 'd2', entryId: 'e2' },
    });
    expect(await raw.ttl(`${prefix}:agentSteer:hetero_deliveries:v1:op-1`)).toBeGreaterThan(0);

    await queue.removeHeteroDelivery('op-1', 'msg-1');
    expect(Object.keys(await queue.listHeteroDeliveries('op-1'))).toEqual(['msg-2']);
    expect(await queue.listHeteroDeliveries('op-other')).toEqual({});
  });
});
