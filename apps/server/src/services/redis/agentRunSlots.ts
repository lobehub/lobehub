import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('agentRun');

/**
 * KEYS[1] = slots hash; ARGV = holder, now, expiresAt, limit (-1 = no limit).
 * Drops lapsed leases, then takes or refreshes the holder's lease unless the
 * other live leases already reach the limit. Returns { taken, live leases }.
 */
const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[2])
local entries = redis.call('HGETALL', KEYS[1])
local others = 0
for i = 1, #entries, 2 do
  if tonumber(entries[i + 1]) <= now then
    redis.call('HDEL', KEYS[1], entries[i])
  elseif entries[i] ~= ARGV[1] then
    others = others + 1
  end
end
local limit = tonumber(ARGV[4])
if limit >= 0 and others >= limit and redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then
  return { 0, others }
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('PEXPIREAT', KEYS[1], ARGV[3])
return { 1, others + 1 }
`;

/** KEYS[1] = slots hash; ARGV = holder, expiresAt. Extends only a lease that still exists. */
const RENEW_SCRIPT = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('PEXPIREAT', KEYS[1], ARGV[2])
return 1
`;

/** KEYS[1] = slots hash; ARGV = from holder, to holder, expiresAt. Moves a lease to a new holder id. */
const REBIND_SCRIPT = `
if redis.call('HDEL', KEYS[1], ARGV[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIREAT', KEYS[1], ARGV[3])
return 1
`;

export type AgentRunSlotAcquireResult =
  | { inFlight: number; status: 'acquired' }
  | { inFlight: number; status: 'full' }
  | { status: 'unavailable' };

/**
 * Per-user leases on in-flight agent runs, one hash field per holder. A lease
 * lapses unless renewed, so a run that stops without releasing frees its slot
 * on its own. Every write sets the whole key to expire with its newest lease:
 * leases share one TTL, so no live lease outlives the key.
 *
 * Callers decide the limit; this domain only counts.
 */
export const agentRunSlots = {
  /**
   * Takes a lease for `holderId`, or refreshes the one it already holds.
   *
   * @param limit maximum live leases, counting this one; `null` takes the
   *   lease without checking (a run that must be counted but not refused)
   * @returns `unavailable` without Redis or on a Redis error, so callers can fail open
   */
  async acquire(
    userId: string,
    holderId: string,
    { limit, ttlMs }: { limit: number | null; ttlMs: number },
  ): Promise<AgentRunSlotAcquireResult> {
    const redis = await getClient();
    if (!redis) return { status: 'unavailable' };

    const now = Date.now();
    try {
      const [taken, inFlight] = await redis.eval<[number, number]>(
        ACQUIRE_SCRIPT,
        1,
        RedisKeys.agentRun.runSlots(userId),
        holderId,
        String(now),
        String(now + ttlMs),
        String(limit ?? -1),
      );
      return { inFlight: Number(inFlight), status: taken === 1 ? 'acquired' : 'full' };
    } catch (error) {
      console.warn('[agentRunSlots] acquire failed:', error);
      return { status: 'unavailable' };
    }
  },

  /** Best effort: moves the lease taken under a provisional id to the run's real id. */
  async rebind(userId: string, fromHolderId: string, toHolderId: string, ttlMs: number) {
    const redis = await getClient();
    if (!redis) return;

    await redis
      .eval(
        REBIND_SCRIPT,
        1,
        RedisKeys.agentRun.runSlots(userId),
        fromHolderId,
        toHolderId,
        String(Date.now() + ttlMs),
      )
      .catch(() => undefined);
  },

  /** Best effort: frees the holder's slot; a lease that cannot be released lapses on its own. */
  async release(userId: string, holderId: string) {
    const redis = await getClient();
    if (!redis) return;

    await redis.hdel(RedisKeys.agentRun.runSlots(userId), holderId).catch(() => undefined);
  },

  /** Best effort: extends the holder's lease; never recreates one that already lapsed. */
  async renew(userId: string, holderId: string, ttlMs: number) {
    const redis = await getClient();
    if (!redis) return;

    await redis
      .eval(
        RENEW_SCRIPT,
        1,
        RedisKeys.agentRun.runSlots(userId),
        holderId,
        String(Date.now() + ttlMs),
      )
      .catch(() => undefined);
  },
};
