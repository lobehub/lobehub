// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redisAvailable: true,
  store: new Map<string, string>(),
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () =>
    mocks.redisAvailable
      ? {
          del: async (key: string) => mocks.store.delete(key),
          get: async (key: string) => mocks.store.get(key) ?? null,
          set: async (key: string, value: string) => mocks.store.set(key, value),
        }
      : null,
}));

const { clearReactionTrackerMemoryCache, readReactionIds, writeReactionIds, deleteReactionIds } =
  await import('./reactionTracker');

describe('reactionTracker', () => {
  beforeEach(() => {
    mocks.redisAvailable = true;
    mocks.store.clear();
    clearReactionTrackerMemoryCache();
  });

  it('round-trips a list of ids through Redis', async () => {
    await writeReactionIds('lark', 'cli_app', 'om_1', ['rct_a', 'rct_b']);

    await expect(readReactionIds('lark', 'cli_app', 'om_1')).resolves.toEqual(['rct_a', 'rct_b']);
  });

  it('still reads the bare id written by earlier builds during a rolling deploy', async () => {
    mocks.store.set('bot:feishu-reaction-id:lark:cli_app:om_1', 'rct_legacy');

    await expect(readReactionIds('lark', 'cli_app', 'om_1')).resolves.toEqual(['rct_legacy']);
  });

  it('treats an empty list as a delete', async () => {
    await writeReactionIds('lark', 'cli_app', 'om_1', ['rct_a']);
    await writeReactionIds('lark', 'cli_app', 'om_1', []);

    expect(mocks.store.size).toBe(0);
    await expect(readReactionIds('lark', 'cli_app', 'om_1')).resolves.toEqual([]);
  });

  describe('without Redis', () => {
    beforeEach(() => {
      mocks.redisAvailable = false;
    });

    it('keeps the ids in process memory so local runs swap instead of stacking', async () => {
      // Local (non-queue) execution drives received → thinking → working →
      // clear in one process; dropping the ids would leave every step on the
      // message.
      await writeReactionIds('lark', 'cli_app', 'om_1', ['rct_a']);

      await expect(readReactionIds('lark', 'cli_app', 'om_1')).resolves.toEqual(['rct_a']);
      await deleteReactionIds('lark', 'cli_app', 'om_1');
      await expect(readReactionIds('lark', 'cli_app', 'om_1')).resolves.toEqual([]);
    });
  });
});
