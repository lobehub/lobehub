import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';
import { isDev } from '@/utils/env';

const APPLE_TRUSTED_ORIGIN = 'https://appleid.apple.com';
const MOBILE_APP_SCHEME = 'com.lobehub.app://';
const EXPO_DEV_SCHEME = 'exp://*/*';

/**
 * Normalize a URL-like string to an origin with https fallback.
 * Returns the original string if it's a custom scheme (e.g., com.lobehub.app://).
 */
export const normalizeOrigin = (url?: string) => {
  if (!url) return undefined;

  // Handle custom schemes (e.g., mobile app deep links)
  if (url.includes('://') && !url.startsWith('http')) {
    return url;
  }

  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

    return new URL(normalizedUrl).origin;
  } catch {
    return undefined;
  }
};

const parseTrustedOrigins = (value?: string) =>
  value
    ?.split(',')
    .map((item) => normalizeOrigin(item.trim()))
    .filter((origin): origin is string => Boolean(origin));

const mergeTrustedOrigins = (...originGroups: Array<string[] | undefined>) => {
  const mergedOrigins = new Set(originGroups.flatMap((origins) => origins ?? []));

  return mergedOrigins.size > 0 ? Array.from(mergedOrigins) : undefined;
};

/**
 * Build trusted origins with Vercel-aware defaults and optional additions.
 * AUTH_TRUSTED_ORIGINS keeps its replacement semantics, while
 * AUTH_ADDITIONAL_TRUSTED_ORIGINS is merged into either the override or the defaults.
 */
export const getTrustedOrigins = (enabledSSOProviders: string[]) => {
  const additionalOrigins = parseTrustedOrigins(authEnv.AUTH_ADDITIONAL_TRUSTED_ORIGINS);
  const originsFromEnv = parseTrustedOrigins(authEnv.AUTH_TRUSTED_ORIGINS);

  if (originsFromEnv?.length) {
    return mergeTrustedOrigins(originsFromEnv, additionalOrigins);
  }

  const defaults = [
    normalizeOrigin(appEnv.APP_URL),
    normalizeOrigin(process.env.VERCEL_URL),
    normalizeOrigin(process.env.VERCEL_BRANCH_URL),
    MOBILE_APP_SCHEME,
    // Add expo URL in development
    ...(isDev ? [EXPO_DEV_SCHEME] : []),
  ].filter(Boolean) as string[];

  const providerOrigins = enabledSSOProviders.includes('apple')
    ? [APPLE_TRUSTED_ORIGIN]
    : undefined;

  return mergeTrustedOrigins(defaults, providerOrigins, additionalOrigins);
};

/**
 * Build Better Auth secondaryStorage backed by Redis.
 * Uses the shared Redis manager to avoid duplicate connections and prefixes keys to prevent clashes.
 */
export const createSecondaryStorage = () => {
  const redisConfig = getRedisConfig();
  if (!isRedisEnabled(redisConfig)) return undefined;

  const secondaryStorageKeyPrefix = 'better-auth:';

  const buildKey = (key: string) => `${secondaryStorageKeyPrefix}${key}`;

  const getRedisClient = async () => {
    const redisClient = await initializeRedis(redisConfig);
    if (!redisClient) {
      throw new Error('Redis secondary storage is enabled but failed to initialize');
    }

    return redisClient;
  };

  return {
    delete: async (key: string) => {
      const redisClient = await getRedisClient();
      await redisClient.del(buildKey(key));
    },
    get: async (key: string) => {
      const redisClient = await getRedisClient();
      return (await redisClient.get(buildKey(key))) ?? null;
    },
    set: async (key: string, value: string, ttl?: number) => {
      const redisClient = await getRedisClient();
      if (typeof ttl === 'number') {
        await redisClient.set(buildKey(key), value, { ex: ttl });
        return;
      }

      await redisClient.set(buildKey(key), value);
    },
  };
};
