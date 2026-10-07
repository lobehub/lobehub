import type { DeviceSystemInfo } from '@lobechat/device-gateway-client';

import { readThroughRedis, RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

export const deviceSystemInfo = {
  async remember(
    scope: { deviceId: string; userId: string; workspaceId?: string },
    fetch: () => Promise<DeviceSystemInfo | undefined>,
    maxAgeMs = 3 * 60 * 1000,
  ) {
    return readThroughRedis(
      await getRedisServiceClient(),
      RedisKeys.sendPathCache.deviceSystemInfo(
        scope.userId,
        scope.workspaceId ?? 'personal',
        scope.deviceId,
      ),
      fetch,
      { ttlMs: maxAgeMs },
    );
  },
};
