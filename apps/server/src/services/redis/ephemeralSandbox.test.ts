import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ephemeralSandbox } from './ephemeralSandbox';

const hashes = new Map<string, Record<string, string>>();
const expiries = new Map<string, number>();
const redis = vi.hoisted(() => ({ client: null as any }));
vi.mock('./client', () => ({ getRedisServiceClient: async () => redis.client }));

const memoryClient = {
  hgetall: vi.fn(async (key: string) => hashes.get(key) ?? {}),
  pipeline: () => {
    const ops: (() => void)[] = [];
    const pipeline = {
      exec: async () => {
        for (const op of ops) op();
        return [];
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => expiries.set(key, seconds));
        return pipeline;
      },
      hset: (key: string, field: string, value: string) => {
        ops.push(() => hashes.set(key, { ...hashes.get(key), [field]: value }));
        return pipeline;
      },
    };
    return pipeline;
  },
};

const KEY = 'ephemeral_sandbox:v1:user-1:tpc_1';

beforeEach(() => {
  hashes.clear();
  expiries.clear();
  redis.client = memoryClient;
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});

describe('redisService.ephemeralSandbox', () => {
  it('reads nothing recorded as null, and no Redis as undefined', async () => {
    expect(await ephemeralSandbox.read('user-1', 'tpc_1')).toBeNull();

    redis.client = null;
    expect(await ephemeralSandbox.read('user-1', 'tpc_1')).toBeUndefined();
    await expect(ephemeralSandbox.recordAgentActivity('user-1', 'tpc_1')).resolves.toBeUndefined();
  });

  it('keeps what the agent did and what a read found apart, per user and topic', async () => {
    await ephemeralSandbox.recordAgentActivity('user-1', 'tpc_1');
    vi.setSystemTime(1_800_000_060_000);
    await ephemeralSandbox.recordRecycled('user-1', 'tpc_1');

    expect(await ephemeralSandbox.read('user-1', 'tpc_1')).toEqual({
      activeAt: 1_800_000_000_000,
      aliveAt: 1_800_000_000_000,
      recycledAt: 1_800_000_060_000,
    });
    expect(await ephemeralSandbox.read('user-2', 'tpc_1')).toBeNull();

    await ephemeralSandbox.recordAgentActivity('user-1', 'tpc_1', {
      keepAliveUntil: 1_900_000_000_000,
    });
    expect((await ephemeralSandbox.read('user-1', 'tpc_1'))?.keepAliveUntil).toBe(
      1_900_000_000_000,
    );
    expect(expiries.get(KEY)).toBe(30 * 24 * 60 * 60);
  });

  it('moves only the alive mark on a read that reached the sandbox', async () => {
    await ephemeralSandbox.recordAgentActivity('user-1', 'tpc_1');
    vi.setSystemTime(1_800_000_060_000);
    await ephemeralSandbox.recordAlive('user-1', 'tpc_1');

    expect(await ephemeralSandbox.read('user-1', 'tpc_1')).toEqual({
      activeAt: 1_800_000_000_000,
      aliveAt: 1_800_000_060_000,
    });
  });
});
