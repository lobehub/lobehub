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

/**
 * Build trusted origins with env override and Vercel-aware defaults.
 */
export const getTrustedOrigins = (enabledSSOProviders: string[]) => {
  if (authEnv.AUTH_TRUSTED_ORIGINS) {
    const originsFromEnv = authEnv.AUTH_TRUSTED_ORIGINS.split(',')
      .map((item) => {
        const trimmed = item.trim();
        // Handle custom schemes directly
        if (trimmed.includes('://') && !trimmed.startsWith('http')) {
          return trimmed;
        }
        return normalizeOrigin(trimmed);
      })
      .filter(Boolean) as string[];

    if (originsFromEnv.length > 0) return Array.from(new Set(originsFromEnv));
  }

  const defaults = [
    normalizeOrigin(appEnv.APP_URL),
    normalizeOrigin(process.env.VERCEL_URL),
    normalizeOrigin(process.env.VERCEL_BRANCH_URL),
    MOBILE_APP_SCHEME,
    // Add expo URL in development
    ...(isDev ? [EXPO_DEV_SCHEME] : []),
  ].filter(Boolean) as string[];

  const baseTrustedOrigins = defaults.length > 0 ? Array.from(new Set(defaults)) : undefined;

  if (!enabledSSOProviders.includes('apple')) return baseTrustedOrigins;

  const mergedOrigins = new Set(baseTrustedOrigins || []);
  mergedOrigins.add(APPLE_TRUSTED_ORIGIN);

  return Array.from(mergedOrigins);
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
