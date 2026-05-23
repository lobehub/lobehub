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
