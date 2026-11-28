import { beforeEach, describe, expect, it, vi } from 'vitest';

import { botDeferred } from './botDeferred';

const counters = new Map<string, number>();
const ttls = new Map<string, number>();
const redis = vi.hoisted(() => ({ client: null as any, scope: undefined as string | undefined }));
vi.mock('./client', () => ({
  getRedisServiceClient: async (scope: string) => {
    redis.scope = scope;
    return redis.client;
  },
}));

const memoryClient = {
  mget: vi.fn(async (...keys: string[]) =>
    keys.map((key) => (counters.has(key) ? String(counters.get(key)) : null)),
  ),
  pipeline: () => {
    const queued: Array<() => void> = [];
    const add = (key: string, by: number) => counters.set(key, (counters.get(key) ?? 0) + by);
    const chain: any = {
      decr: (key: string) => (queued.push(() => add(key, -1)), chain),
      exec: async () => queued.map((run) => [null, run()]),
      expire: (key: string, seconds: number) => (queued.push(() => ttls.set(key, seconds)), chain),
      incr: (key: string) => (queued.push(() => add(key, 1)), chain),
    };
    return chain;
  },
};

const KEY = 'replays:v1:app-1:feishu:group:oc_1:om_1';

beforeEach(() => {
  counters.clear();
  ttls.clear();
  vi.clearAllMocks();
  redis.client = memoryClient;
});

describe('redisService.botDeferred', () => {
  it('counts replays per message under the bot-deferred scope, each key for 30 minutes', async () => {
    await botDeferred.countReplays('app-1', 'feishu:group:oc_1', ['om_1', 'om_2']);
    await botDeferred.countReplays('app-1', 'feishu:group:oc_1', ['om_1']);

    expect(redis.scope).toBe('botDeferred');
    expect(
      await botDeferred.replayCounts('app-1', 'feishu:group:oc_1', ['om_1', 'om_2', 'om_3']),
    ).toEqual([2, 1, 0]);
    expect(ttls.get(KEY)).toBe(30 * 60);
    expect(ttls.get('replays:v1:app-1:feishu:group:oc_1:om_2')).toBe(30 * 60);
  });

  it('gives a lap back on refund', async () => {
    await botDeferred.countReplays('app-1', 'feishu:group:oc_1', ['om_1']);
    await botDeferred.refundReplays('app-1', 'feishu:group:oc_1', ['om_1']);

    expect(await botDeferred.replayCounts('app-1', 'feishu:group:oc_1', ['om_1'])).toEqual([0]);
    expect(ttls.get(KEY)).toBe(30 * 60);
  });

  it('reports no counts without Redis and treats writes as no-ops', async () => {
    redis.client = null;

    await expect(
      botDeferred.countReplays('app-1', 'feishu:group:oc_1', ['om_1']),
    ).resolves.toBeUndefined();
    expect(await botDeferred.replayCounts('app-1', 'feishu:group:oc_1', ['om_1'])).toBeUndefined();
  });

  it('reports no counts when the read fails, so the caller fails open', async () => {
    memoryClient.mget.mockRejectedValueOnce(new Error('connection reset'));

    expect(await botDeferred.replayCounts('app-1', 'feishu:group:oc_1', ['om_1'])).toBeUndefined();
  });
});
