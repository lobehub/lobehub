import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('agentSteer');

// Covers one start (operation row created, first step dispatched); a fence its
// holder never released lapses after this.
const FENCE_TTL_MS = 30 * 1000;
const RETRY_DELAY_MS = 100;

/** KEYS[1] = fence; ARGV[1] = owner. Releases only the caller's own fence. */
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A short mutual-exclusion fence around starting a run on an existing thread.
 * Thread starts deliberately skip the topic-start reservation, so without it a
 * queued follow-up's "is a run live here?" check and its start could interleave
 * with a foreground send on the same thread.
 */
export const threadStartFence = {
  /**
   * Waits up to `waitMs` for the fence.
   *
   * @returns `held` when this caller owns it, `busy` when another start kept it
   * for the whole wait, `unavailable` without Redis
   */
  async acquire(
    threadId: string,
    owner: string,
    waitMs: number,
  ): Promise<'busy' | 'held' | 'unavailable'> {
    const redis = await getClient();
    if (!redis) return 'unavailable';

    const key = RedisKeys.agentSteer.threadStartFence(threadId);
    const deadline = Date.now() + waitMs;
    try {
      for (;;) {
        if ((await redis.set(key, owner, { nx: true, px: FENCE_TTL_MS })) === 'OK') return 'held';
        if (Date.now() >= deadline) return 'busy';
        await sleep(RETRY_DELAY_MS);
      }
    } catch {
      return 'unavailable';
    }
  },

  /** Best effort: a fence that cannot be released lapses on its own. */
  async release(threadId: string, owner: string): Promise<void> {
    const redis = await getClient();
    if (!redis) return;

    await redis
      .eval(RELEASE_SCRIPT, 1, RedisKeys.agentSteer.threadStartFence(threadId), owner)
      .catch(() => undefined);
  },
};
