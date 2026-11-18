// @vitest-environment node
import type IORedisClient from 'ioredis';
import { afterAll, beforeAll, describe, vi } from 'vitest';

import type { heteroControl as HeteroControl } from './heteroControl';
import { defineHeteroControlCases } from './heteroControl.cases';

/**
 * Runs the control queue's Lua scripts against a real Redis. Skipped unless
 * `HETERO_CONTROL_REAL_REDIS_URL` points at a disposable instance:
 *
 *   docker run -d -p 127.0.0.1:6393:6379 redis:7-alpine
 *   HETERO_CONTROL_REAL_REDIS_URL=redis://127.0.0.1:6393 bunx vitest run apps/server/src/services/redis/heteroControl.realRedis.test.ts
 */
const url = process.env.HETERO_CONTROL_REAL_REDIS_URL;

describe.skipIf(!url)('heteroControl (real Redis)', () => {
  const prefix = `hetero-control-test-${Date.now()}`;
  let queue: typeof HeteroControl;
  let raw: IORedisClient;

  beforeAll(async () => {
    vi.resetModules();
    process.env.REDIS_URL = url;
    process.env.REDIS_PREFIX = prefix;
    queue = (await import('./heteroControl')).heteroControl;
    const { default: IORedis } = await import('ioredis');
    raw = new IORedis(url!);
  });

  afterAll(async () => {
    const keys = await raw.keys(`${prefix}:*`);
    if (keys.length > 0) await raw.del(...keys);
    raw.disconnect();
  });

  defineHeteroControlCases(() => queue);
});
