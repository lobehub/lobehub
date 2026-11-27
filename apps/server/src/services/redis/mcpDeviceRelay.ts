import type { DeviceClient } from '@lobechat/types';

import { RedisKeys } from '@/server/modules/Redis';

import { readThroughRedis } from './cache';
import { getRedisServiceClient } from './client';

/** How long a device client's MCP features are trusted: they change when it upgrades. */
const FEATURES_TTL_MS = 60 * 1000;
/**
 * How long a view's resolved device stays trusted. A view polls its tools many
 * times a second; each call would otherwise repeat the device authorization,
 * presence and capability reads. Short, so a device that went offline or was
 * unshared stops being reached within seconds.
 */
const TARGET_TTL_MS = 15 * 1000;

/** The device an MCP App view's calls and reads are relayed to, as last resolved. */
export interface McpRelayTargetEntry {
  /** The device client serves MCP Apps views (`supportedMcpFeatures`). */
  apps: boolean;
  clientKinds: DeviceClient[];
  deviceId: string;
  workspaceId?: string;
}

/** Caches for MCP calls tunneled to a user's device (stdio / local-network servers). */
export const mcpDeviceRelay = {
  /** The MCP features the device client that runs these calls reports. */
  async rememberFeatures(
    scope: { clientKinds: DeviceClient[]; deviceId: string; userId: string; workspaceId?: string },
    fetch: () => Promise<string[] | undefined>,
  ) {
    return readThroughRedis(
      await getRedisServiceClient('sendPathCache'),
      RedisKeys.sendPathCache.mcpDeviceFeatures(
        scope.userId,
        scope.workspaceId ?? 'personal',
        scope.deviceId,
        [...scope.clientKinds].sort().join(','),
      ),
      fetch,
      { ttlMs: FEATURES_TTL_MS },
    );
  },

  /** The device a connector's view calls go to, per user, pool, connector and device. */
  async rememberTarget(
    scope: { connectorId: string; deviceId: string; userId: string; workspaceId?: string },
    fetch: () => Promise<McpRelayTargetEntry>,
  ) {
    return readThroughRedis(
      await getRedisServiceClient('sendPathCache'),
      RedisKeys.sendPathCache.mcpRelayTarget(
        scope.userId,
        scope.workspaceId ?? 'personal',
        scope.connectorId,
        scope.deviceId,
      ),
      fetch,
      { ttlMs: TARGET_TTL_MS },
    );
  },
};
