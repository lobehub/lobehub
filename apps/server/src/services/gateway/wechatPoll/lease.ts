import type Redis from 'ioredis';

import { WECHAT_POLL_LEASE_TTL_MS } from './config';

/**
 * Compare-and-set key locks. Used for two things:
 *
 *  - the per-shard worker lease: the cron fires every minute against every
 *    shard route; whichever invocation wins `SET NX` becomes the worker,
 *    everyone else returns immediately;
 *  - the global mode-transition lock (see mode.ts).
 *
 * Renew/release are CAS (Lua) so a holder whose lock already expired and was
 * taken over can never clobber the new holder.
 */

const leaseKey = (shard: number): string => `wechat:poll:lease:${shard}`;

// KEYS[1] = lock key, ARGV[1] = holder id, ARGV[2] = ttl ms
const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export const acquireKeyLock = async (
  redis: Redis,
  key: string,
  holder: string,
  ttlMs: number,
): Promise<boolean> => {
  const result = await redis.set(key, holder, 'PX', ttlMs, 'NX');
  return result === 'OK';
};

/** Returns false when the lock is no longer ours — the holder must stop. */
export const renewKeyLock = async (
  redis: Redis,
  key: string,
  holder: string,
  ttlMs: number,
): Promise<boolean> => {
  const result = await redis.eval(RENEW_SCRIPT, 1, key, holder, ttlMs);
  return result === 1;
};

export const releaseKeyLock = async (redis: Redis, key: string, holder: string): Promise<void> => {
  await redis.eval(RELEASE_SCRIPT, 1, key, holder);
};

// ─── Shard worker lease ───

export const shardLeaseKey = leaseKey;

export const acquireLease = (
  redis: Redis,
  shard: number,
  workerId: string,
  ttlMs: number = WECHAT_POLL_LEASE_TTL_MS,
): Promise<boolean> => acquireKeyLock(redis, leaseKey(shard), workerId, ttlMs);

export const renewLease = (
  redis: Redis,
  shard: number,
  workerId: string,
  ttlMs: number = WECHAT_POLL_LEASE_TTL_MS,
): Promise<boolean> => renewKeyLock(redis, leaseKey(shard), workerId, ttlMs);

export const releaseLease = (redis: Redis, shard: number, workerId: string): Promise<void> =>
  releaseKeyLock(redis, leaseKey(shard), workerId);
