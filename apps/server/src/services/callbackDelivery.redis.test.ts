import { randomUUID } from 'node:crypto';

import Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  claimDeliveryChunk,
  getDeliveredChunkCount,
  releaseDeliveryLease,
} from './callbackDelivery';

const safeRedisUrl = (): string | undefined => {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  if (!process.env.REDIS_URL) return undefined;
  const hostname = new URL(process.env.REDIS_URL).hostname;
  return ['127.0.0.1', '::1', 'localhost'].includes(hostname) ? process.env.REDIS_URL : undefined;
};

const redisUrl = safeRedisUrl();
const describeWithRedis = redisUrl ? describe : describe.skip;
const keys = new Set<string>();
let redis: Redis;

describeWithRedis('callback delivery Redis invariants', () => {
  beforeAll(async () => {
    redis = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    await redis.ping();
  });

  afterEach(async () => {
    if (keys.size > 0) await redis.del(...[...keys].flatMap((key) => [key, `${key}:lease`]));
    keys.clear();
  });

  afterAll(async () => redis.quit());

  it('allows only one worker to reserve each outbound chunk', async () => {
    const key = `callback-delivery-test:${randomUUID()}`;
    keys.add(key);

    const owners = Array.from({ length: 8 }, () => randomUUID());
    const claims = await Promise.allSettled(
      owners.map((owner) => claimDeliveryChunk(redis, key, 1, owner)),
    );

    expect(claims.filter((claim) => claim.status === 'fulfilled' && claim.value)).toHaveLength(1);
    await expect(getDeliveredChunkCount(redis, key)).resolves.toBe(1);
    const winner = claims.findIndex((claim) => claim.status === 'fulfilled' && claim.value);
    await expect(claimDeliveryChunk(redis, key, 1, owners[winner])).resolves.toBe(false);
    await expect(claimDeliveryChunk(redis, key, 2, randomUUID())).rejects.toThrow('in progress');
    await releaseDeliveryLease(redis, key, owners[winner]);
    await expect(claimDeliveryChunk(redis, key, 2, randomUUID())).resolves.toBe(true);
  });
});
