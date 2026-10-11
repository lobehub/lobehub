import { RedisKeys } from '@/server/modules/Redis';

import { readThroughRedis } from './cache';
import { getRedisServiceClient } from './client';

export const skillTools = {
  async remember<T extends { source?: string; tools?: unknown[] } | undefined>(
    scope: {
      connection: { createdAt?: string; providerUserId?: string };
      providerId: string;
      userId: string;
    },
    fetch: () => Promise<T>,
  ): Promise<T> {
    const identity = [scope.connection.createdAt ?? '', scope.connection.providerUserId ?? ''].join(
      '|',
    );
    return readThroughRedis(
      await getRedisServiceClient(),
      RedisKeys.sendPathCache.lobehubSkillTools(scope.userId, scope.providerId, identity),
      fetch,
      {
        // Only a successful live probe is worth remembering: the fallback
        // (`source: 'static'`) is a cheap static catalog served when the live
        // probe failed, and pinning it for the TTL would keep the next sends
        // from retrying live discovery against the connection.
        shouldCache: (value) =>
          value?.source === 'live' && Array.isArray(value.tools) && value.tools.length > 0,
        ttlMs: 10 * 60 * 1000,
      },
    );
  },
};
