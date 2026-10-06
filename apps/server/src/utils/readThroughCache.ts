import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:read-through-cache');

const KEY_PREFIX = 'send_path_cache';

export interface ReadThroughOptions<T> {
  /** Cache this value? Defaults to caching anything that is not `undefined`. */
  shouldCache?: (value: T) => boolean;
  /** How long a cached answer stays valid. */
  ttlMs: number;
}

/**
 * Serve `read()` from Redis for `ttlMs`, falling back to the live read when
 * the cache is unavailable or empty. Built for the send path's repeated,
 * slow-but-stable lookups (a device's system info, a skill's live tool list):
 * answers that cost a network round trip per send and change on the order of
 * minutes, not seconds.
 *
 * Failure-tolerant on both sides: a Redis error or a missing client degrades
 * to the live read, and a live read that rejects is NOT cached — the next
 * send retries. A key must already carry everything the answer depends on
 * (user, device, connection identity); this helper never derives it.
 */
export const readThrough = async <T>(
  key: string,
  read: () => Promise<T>,
  { shouldCache, ttlMs }: ReadThroughOptions<T>,
): Promise<T> => {
  const redis = getAgentRuntimeRedisClient();
  const cacheKey = `${KEY_PREFIX}:${key}`;

  if (redis) {
    try {
      const hit = await redis.get(cacheKey);
      if (hit !== null) {
        log('hit %s', key);
        return JSON.parse(hit) as T;
      }
    } catch (error) {
      log('read failed for %s, falling through: %O', key, error);
    }
  }

  const value = await read();
  const cacheable = value !== undefined && (shouldCache ? shouldCache(value) : true);

  if (redis && cacheable) {
    // Fire-and-forget: the caller already has its answer, and a failed write
    // only costs the next send one live read.
    redis
      .set(cacheKey, JSON.stringify(value), 'PX', Math.max(1, Math.round(ttlMs)))
      .catch((error) => log('write failed for %s: %O', key, error));
  }

  return value;
};
