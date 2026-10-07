import {
  type BaseRedisProvider,
  type RedisKey,
  type RedisMSetArgument,
  type RedisValue,
  type SetOptions,
} from './types';

export const normalizeRedisKey = (key: RedisKey) =>
  typeof key === 'string' ? key : key.toString();

export const normalizeRedisKeys = (keys: RedisKey[]) => keys.map(normalizeRedisKey);

export const normalizeMsetValues = (values: RedisMSetArgument): Record<string, RedisValue> => {
  if (values instanceof Map) {
    return Array.from(values.entries()).reduce<Record<string, RedisValue>>((acc, [key, value]) => {
      acc[normalizeRedisKey(key)] = value;
      return acc;
    }, {});
  }

  return values;
};

/**
 * Read a JSON-encoded value from Redis with consistent null fallbacks:
 *
 * - `null` redis client (Redis disabled / not initialized) → `null`
 * - missing key                                            → `null`
 * - malformed JSON                                         → `null`
 *
 * Lets callers reduce the typical 8-line "fetch + parse + try/catch" recipe
 * to a single call. Caller is responsible for resolving the right Redis
 * client (e.g. via `initializeRedisWithPrefix`) — this helper deliberately
 * stays I/O-only.
 */
export const getJSONFromRedis = async <T>(
  redis: BaseRedisProvider | null,
  key: RedisKey,
): Promise<T | null> => {
  if (!redis) return null;
  const value = await redis.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

export const buildIORedisSetArgs = (options?: SetOptions): Array<string | number> => {
  if (!options) return [];

  const args: Array<string | number> = [];

  if (options.ex !== undefined) args.push('EX', options.ex);
  if (options.px !== undefined) args.push('PX', options.px);
  if (options.exat !== undefined) args.push('EXAT', options.exat);
  if (options.pxat !== undefined) args.push('PXAT', options.pxat);
  if (options.keepTtl) args.push('KEEPTTL');
  if (options.nx) args.push('NX');
  if (options.xx) args.push('XX');
  if (options.get) args.push('GET');

  return args;
};

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

/**
 * Claim the right to do one piece of work for `ttlMs`: the first caller gets
 * `true`, every later caller with the same key gets `false` until the claim
 * expires. Atomic across instances (`SET NX`). Built for background refreshes
 * that fan out from concurrent requests — one should do the work, the rest
 * should not pile on.
 *
 * Without a client there is nothing to coordinate through, so the claim is
 * granted: the caller does its work, as it would have before any claim
 * existed. A claim is never released early — a successful refresh makes the
 * next read fresh anyway, and a failed one is retried once the claim expires.
 */
export const claimRedisOnce = async (
  redis: BaseRedisProvider | null,
  key: RedisKey,
  ttlMs: number,
): Promise<boolean> => {
  if (!redis) return true;
  const result = await redis.set(key, '1', { nx: true, px: Math.max(1, Math.round(ttlMs)) });
  return result === 'OK';
};
