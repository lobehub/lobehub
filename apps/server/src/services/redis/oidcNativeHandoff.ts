import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

/**
 * Counts one native-app handoff request against the user's fixed window.
 *
 * Returns the count inside the window, or `undefined` when Redis is unavailable so the
 * caller can apply its own fallback limit.
 */
export const oidcNativeHandoff = {
  async countRequest(userId: string, windowSeconds: number) {
    const redis = await getRedisServiceClient('lobechat');
    if (!redis) return;

    const key = RedisKeys.lobechat.oidcNativeHandoff(userId);
    await redis.set(key, '0', { ex: windowSeconds, nx: true });
    return redis.incr(key);
  },
};
