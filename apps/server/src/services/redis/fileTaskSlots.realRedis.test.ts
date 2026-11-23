// @vitest-environment node
import type IORedisClient from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { fileTaskSlots } from './fileTaskSlots';

/**
 * Runs the file-task slot Lua scripts against a real Redis. Skipped unless
 * `FILE_TASK_SLOTS_REAL_REDIS_URL` points at a disposable instance:
 *
 *   docker run -d -p 127.0.0.1:6391:6379 redis:7-alpine
 *   FILE_TASK_SLOTS_REAL_REDIS_URL=redis://127.0.0.1:6391 vitest run apps/server/src/services/redis/fileTaskSlots.realRedis.test.ts
 */
const url = process.env.FILE_TASK_SLOTS_REAL_REDIS_URL;

describe.skipIf(!url)('fileTaskSlots redis domain (real Redis)', () => {
  const prefix = `file-task-slots-test-${Date.now()}`;
  const limits = { globalLimit: 5, scopeLimit: 3, ttlMs: 60_000 };
  let domain: typeof fileTaskSlots;
  let raw: IORedisClient;

  beforeAll(async () => {
    vi.resetModules();
    process.env.REDIS_URL = url;
    process.env.REDIS_PREFIX = prefix;
    domain = (await import('./fileTaskSlots')).fileTaskSlots;
    const { default: IORedis } = await import('ioredis');
    raw = new IORedis(url!);
  });

  afterAll(async () => {
    const keys = await raw.keys(`${prefix}:*`);
    if (keys.length > 0) await raw.del(...keys);
    raw.disconnect();
  });

  const globalKey = () => `${prefix}:file-task:{file-task}:slots:v1:global`;

  it('never overshoots a limit under concurrent acquires', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) => domain.acquire('race', `h-${index}`, limits)),
    );

    expect(results.filter((result) => result.status === 'acquired')).toHaveLength(3);
    await Promise.all(Array.from({ length: 50 }, (_, i) => domain.release('race', `h-${i}`)));
    expect(await raw.zcard(globalKey())).toBe(0);
  });

  it('enforces the global limit across scopes and reopens after a release', async () => {
    for (const [scope, holder] of [
      ['a', '1'],
      ['a', '2'],
      ['b', '3'],
      ['b', '4'],
      ['c', '5'],
    ]) {
      expect((await domain.acquire(scope, holder, limits)).status).toBe('acquired');
    }
    expect(await domain.acquire('c', '6', limits)).toMatchObject({
      globalActive: 5,
      status: 'full',
    });

    await domain.release('a', '1');
    expect((await domain.acquire('c', '6', limits)).status).toBe('acquired');

    await Promise.all(
      [
        ['a', '2'],
        ['b', '3'],
        ['b', '4'],
        ['c', '5'],
        ['c', '6'],
      ].map(([scope, holder]) => domain.release(scope, holder)),
    );
  });

  it('reports a lease the holder already has without counting it twice', async () => {
    await domain.acquire('held', 'same', limits);

    expect(await domain.acquire('held', 'same', limits)).toMatchObject({
      scopeActive: 1,
      status: 'held',
    });
    await domain.release('held', 'same');
  });

  it('reclaims a lapsed lease and never renews it back', async () => {
    const short = { ...limits, scopeLimit: 1, ttlMs: 20 };
    await domain.acquire('lapse', 'dead', short);
    await new Promise((resolve) => setTimeout(resolve, 40));

    await domain.renew('lapse', 'other', 60_000);
    expect((await domain.acquire('lapse', 'next', short)).status).toBe('acquired');
    await domain.release('lapse', 'next');
  });

  it('keeps a renewed lease alive past its first expiry', async () => {
    const short = { ...limits, scopeLimit: 1, ttlMs: 40 };
    await domain.acquire('renew', 'live', short);
    await domain.renew('renew', 'live', 60_000);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect((await domain.acquire('renew', 'next', short)).status).toBe('full');
    await domain.release('renew', 'live');
  });
});
