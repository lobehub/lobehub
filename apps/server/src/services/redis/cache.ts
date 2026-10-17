import { getJSONFromRedis, normalizeRedisKey } from '@/server/modules/Redis';
import type { BaseRedisProvider, RedisKey } from '@/server/modules/Redis/types';

// Generic cache/claim policy for the send-path domains. This lives inside the
// service boundary (not `modules/Redis`, which is only the client/provider
// layer) so it is not re-exported as a transport primitive callers can reach
// around the domain methods. See AGENTS.md.

export interface ReadThroughRedisOptions<T> {
  /** Remember this answer? Defaults to remembering anything that is not `undefined`. */
  shouldCache?: (value: T) => boolean;
  /** How long a remembered answer stays valid. */
  ttlMs: number;
}

/**
 * Serve `read()` from Redis for `ttlMs`, falling back to the live read when
 * the client is `null`, the key is missing, or Redis fails. Built for the
 * repeated, slow-but-stable lookups of a hot path — answers that cost a
 * network round trip and change on the order of minutes.
 *
 * Failure-tolerant on both sides: a Redis error degrades to the live read,
 * and a live read that rejects is NOT remembered — the next caller retries.
 * The write-back is fire-and-forget; the caller already has its answer.
 * The key must already carry everything the answer depends on (see
 * `RedisKeys`); this helper never derives it.
 */
export const readThroughRedis = async <T>(
  redis: BaseRedisProvider | null,
  key: RedisKey,
  read: () => Promise<T>,
  { shouldCache, ttlMs }: ReadThroughRedisOptions<T>,
): Promise<T> => {
  if (redis) {
    try {
      const hit = await getJSONFromRedis<T>(redis, key);
      if (hit !== null) return hit;
    } catch {
      // Fall through to the live read.
    }
  }

  const value = await read();
  const cacheable = value !== undefined && (shouldCache ? shouldCache(value) : true);

  if (redis && cacheable) {
    void redis
      .set(key, JSON.stringify(value), { px: Math.max(1, Math.round(ttlMs)) })
      .catch(() => undefined);
  }

  return value;
};

/** Process-local claims, used when Redis cannot coordinate: key → expiry (ms). */
const localClaims = new Map<string, number>();

const claimLocally = (key: RedisKey, ttlMs: number): boolean => {
  const now = Date.now();
  if (localClaims.size > 1000) {
    for (const [k, expiresAt] of localClaims) if (expiresAt <= now) localClaims.delete(k);
  }

  const normalized = normalizeRedisKey(key);
  const expiresAt = localClaims.get(normalized);
  if (expiresAt && expiresAt > now) return false;

  localClaims.set(normalized, now + ttlMs);
  return true;
};

/**
 * Claim the right to do one piece of work for `ttlMs`: the first caller gets
 * `true`, every later caller with the same key gets `false` until the claim
 * expires. Built for background refreshes that fan out from concurrent
 * requests — one should do the work, the rest should not pile on.
 *
 * Atomic across instances through Redis `SET NX`. When Redis is unavailable —
 * disabled, or a command that rejects after the client was memoized — the
 * claim falls back to a process-local one: still enough to stop one instance
 * scheduling the same 30s scan ten times, which is the common shape of a
 * stampede. A claim is never released early: a successful refresh makes the
 * next read fresh anyway, and a failed one is retried once the claim expires.
 */
export const claimRedisOnce = async (
  redis: BaseRedisProvider | null,
  key: RedisKey,
  ttlMs: number,
): Promise<boolean> => {
  const ttl = Math.max(1, Math.round(ttlMs));
  if (!redis) return claimLocally(key, ttl);

  try {
    const result = await redis.set(key, '1', { nx: true, px: ttl });
    return result === 'OK';
  } catch {
    return claimLocally(key, ttl);
  }
};
