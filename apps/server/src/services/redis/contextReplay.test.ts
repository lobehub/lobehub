import type { ContextReplaySnapshot } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONTEXT_REPLAY_TTL_SECONDS } from './contextReplay';
import { redisService } from './index';

const getRedisServiceClient = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ getRedisServiceClient }));

const createFakeRedis = () => {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();
  const expire = vi.fn(async (key: string, seconds: number) => {
    if (!values.has(key)) return 0;
    ttls.set(key, seconds);
    return 1;
  });
  return {
    ttls,
    values,
    expire,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    mget: vi.fn(async (...keys: string[]) => keys.map((key) => values.get(key) ?? null)),
    pipeline: () => {
      const queued: Array<() => Promise<unknown>> = [];
      const pipe = {
        expire: (key: string, seconds: number) => {
          queued.push(() => expire(key, seconds));
          return pipe;
        },
        exec: async () => Promise.all(queued.map((run) => run())),
      };
      return pipe;
    },
    set: vi.fn(async (key: string, value: string, options?: { ex?: number; nx?: boolean }) => {
      if (options?.nx && values.has(key)) return null;
      values.set(key, value);
      if (options?.ex) ttls.set(key, options.ex);
      return 'OK';
    }),
  };
};

const snapshot = (invocationId: string, content: string): ContextReplaySnapshot => ({
  changes: [{ key: 'SystemDateProvider', messages: [{ content, role: 'user' }], sourceIds: [] }],
  invocationId,
  sessionKey: 'anthropic:claude:default:agent',
  sourceIds: [],
  version: 1,
});

describe('redisService.contextReplay', () => {
  let redis: ReturnType<typeof createFakeRedis>;

  beforeEach(() => {
    redis = createFakeRedis();
    getRedisServiceClient.mockResolvedValue(redis);
  });

  afterEach(() => {
    vi.useRealTimers();
    getRedisServiceClient.mockReset();
  });

  it('keeps the first committed snapshot of an invocation', async () => {
    const first = await redisService.contextReplay.commit('user-1', snapshot('msg-1', 'first'));
    const second = await redisService.contextReplay.commit('user-1', snapshot('msg-1', 'second'));

    expect(first).toEqual({ ...snapshot('msg-1', 'first'), createdBy: 'user-1' });
    expect(second).toEqual(first);
    expect([...redis.ttls.values()]).toEqual([CONTEXT_REPLAY_TTL_SECONDS]);
  });

  it('reads back only the snapshots the same user committed', async () => {
    await redisService.contextReplay.commit('user-1', snapshot('msg-1', 'mine'));
    await redisService.contextReplay.commit('user-2', snapshot('msg-2', 'theirs'));

    const read = await redisService.contextReplay.getMany('user-1', ['msg-1', 'msg-2']);

    expect(Object.keys(read)).toEqual(['msg-1']);
    expect(read['msg-1'].changes[0].messages[0].content).toBe('mine');
  });

  it('renews the expiry of the snapshots a call reads', async () => {
    await redisService.contextReplay.commit('user-1', snapshot('msg-1', 'kept'));
    redis.ttls.clear();

    await redisService.contextReplay.getMany('user-1', ['msg-1', 'msg-missing']);

    expect([...redis.ttls.values()]).toEqual([CONTEXT_REPLAY_TTL_SECONDS]);
  });

  it('falls back to process memory that expires when Redis is unavailable', async () => {
    vi.useFakeTimers();
    getRedisServiceClient.mockResolvedValue(null);

    await redisService.contextReplay.commit('user-1', snapshot('msg-local', 'local'));
    expect(Object.keys(await redisService.contextReplay.getMany('user-1', ['msg-local']))).toEqual([
      'msg-local',
    ]);

    vi.advanceTimersByTime(CONTEXT_REPLAY_TTL_SECONDS * 1000 + 1);
    expect(await redisService.contextReplay.getMany('user-1', ['msg-local'])).toEqual({});
  });

  it('rejects a snapshot written for another invocation id', async () => {
    await expect(
      redisService.contextReplay.commit('user-1', snapshot('msg-1', 'x'), 'msg-2'),
    ).rejects.toThrow('another invocation');
  });
});
