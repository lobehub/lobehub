import type { ClaudeCodeQuotaSnapshot } from '@lobechat/electron-client-ipc';

import { lambdaClient } from '@/libs/trpc/client';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';

export interface FetchClaudeCodeQuotaSnapshotParams {
  /** Sample on this bound execution device via the gateway instead of local IPC. */
  deviceId?: string;
  env?: Record<string, string>;
  force?: boolean;
}

/**
 * Claude quota transport chokepoint, mirroring `GitService`: with a `deviceId`
 * the bound execution device samples its own login through the
 * `device.getClaudeCodeQuota` TRPC RPC; without one the local desktop samples
 * over Electron IPC. `null` means the device is offline or its client predates
 * the quota RPC — callers fall back to persisted windows.
 */
export const fetchClaudeCodeQuotaSnapshot = ({
  deviceId,
  env,
  force,
}: FetchClaudeCodeQuotaSnapshotParams): Promise<ClaudeCodeQuotaSnapshot | null> =>
  deviceId
    ? lambdaClient.device.getClaudeCodeQuota.query({
        deviceId,
        env,
        ...(force ? { force: true } : {}),
      })
    : heterogeneousAgentService.getClaudeCodeQuota({ env, ...(force ? { force: true } : {}) });
