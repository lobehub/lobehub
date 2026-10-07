import { readThroughRedis, RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

export const skillTools = {
  async remember<T extends { tools?: unknown[] } | undefined>(
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
        shouldCache: (value) => Array.isArray(value?.tools) && value.tools.length > 0,
        ttlMs: 10 * 60 * 1000,
      },
    );
  },
};
