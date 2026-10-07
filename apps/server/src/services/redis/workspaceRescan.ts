import { claimRedisOnce, RedisKeys } from '@/libs/redis';

import { getRedisServiceClient } from './client';

// Covers the 30 second scan timeout plus writeback. Claims expire rather than release early.
export const workspaceRescan = {
  async claim(scope: { cwd: string; deviceId: string; userId: string; workspaceId?: string }) {
    return claimRedisOnce(
      await getRedisServiceClient(),
      RedisKeys.sendPathCache.workspaceRescanClaim(
        scope.userId,
        scope.workspaceId ?? 'personal',
        scope.deviceId,
        scope.cwd,
      ),
      45 * 1000,
    );
  },
};
