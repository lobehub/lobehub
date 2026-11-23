import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('fileTask');

/**
 * KEYS = scope slots, global slots; ARGV = holder, now, expiresAt, scope limit, global limit.
 * Drops lapsed leases, then takes one in both sets unless either is full. Both limits are
 * checked and written in one script, so concurrent callers can never overshoot either.
 * Returns { 0 full | 1 acquired | 2 already held, scope leases, global leases }.
 */
const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local scopeActive = redis.call('ZCARD', KEYS[1])
local globalActive = redis.call('ZCARD', KEYS[2])
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  return { 2, scopeActive, globalActive }
end
if scopeActive >= tonumber(ARGV[4]) or globalActive >= tonumber(ARGV[5]) then
  return { 0, scopeActive, globalActive }
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
redis.call('PEXPIREAT', KEYS[1], ARGV[3])
redis.call('PEXPIREAT', KEYS[2], ARGV[3])
return { 1, scopeActive + 1, globalActive + 1 }
`;

/** KEYS = scope slots, global slots; ARGV = holder, expiresAt. Never recreates a lapsed lease. */
const RENEW_SCRIPT = `
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
redis.call('PEXPIREAT', KEYS[1], ARGV[2])
redis.call('PEXPIREAT', KEYS[2], ARGV[2])
return 1
`;

/** KEYS = scope slots, global slots; ARGV = holder, now. Returns the live global leases left. */
const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2])
return redis.call('ZCARD', KEYS[2])
`;

export type FileTaskSlotAcquireResult =
  | { globalActive: number; scopeActive: number; status: 'acquired' | 'full' | 'held' }
  | { status: 'unavailable' };

const slotKeys = (scope: string) =>
  [RedisKeys.fileTask.scopeSlots(scope), RedisKeys.fileTask.globalSlots()] as const;

/**
 * Leases on running file parse/embedding tasks, counted per workspace (or personal account)
 * and across the deployment. A lease lapses unless renewed, so a function killed mid-task
 * gives its slot back on its own.
 */
export const fileTaskSlots = {
  /** @returns `unavailable` without Redis or on a Redis error, so the caller picks a fallback */
  async acquire(
    scope: string,
    holderId: string,
    { globalLimit, scopeLimit, ttlMs }: { globalLimit: number; scopeLimit: number; ttlMs: number },
  ): Promise<FileTaskSlotAcquireResult> {
    const redis = await getClient();
    if (!redis) return { status: 'unavailable' };

    const now = Date.now();
    try {
      const [state, scopeActive, globalActive] = await redis.eval<[number, number, number]>(
        ACQUIRE_SCRIPT,
        2,
        ...slotKeys(scope),
        holderId,
        String(now),
        String(now + ttlMs),
        String(scopeLimit),
        String(globalLimit),
      );
      return {
        globalActive: Number(globalActive),
        scopeActive: Number(scopeActive),
        status: state === 1 ? 'acquired' : state === 2 ? 'held' : 'full',
      };
    } catch (error) {
      console.warn('[fileTaskSlots] acquire failed:', error);
      return { status: 'unavailable' };
    }
  },

  /**
   * Best effort: a lease that cannot be released lapses on its own.
   *
   * @returns the live leases left across the deployment, `undefined` when Redis did not answer
   */
  async release(scope: string, holderId: string): Promise<number | undefined> {
    const redis = await getClient();
    if (!redis) return undefined;

    const globalActive = await redis
      .eval<number>(RELEASE_SCRIPT, 2, ...slotKeys(scope), holderId, String(Date.now()))
      .catch(() => undefined);

    return globalActive === undefined ? undefined : Number(globalActive);
  },

  /** Best effort: extends the holder's lease; never recreates one that already lapsed. */
  async renew(scope: string, holderId: string, ttlMs: number) {
    const redis = await getClient();
    if (!redis) return;

    await redis
      .eval(RENEW_SCRIPT, 2, ...slotKeys(scope), holderId, String(Date.now() + ttlMs))
      .catch(() => undefined);
  },
};
