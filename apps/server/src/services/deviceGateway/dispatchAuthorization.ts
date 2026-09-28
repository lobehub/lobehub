import type { LobeChatDatabase } from '@lobechat/database';
import type { DeviceUnavailableErrorData } from '@lobechat/types';

import { DeviceModel } from '@/database/models/device';

/**
 * Rechecks workspace registry authority immediately before device dispatch.
 *
 * Use when:
 * - A previously selected workspace device is about to receive new work
 * - Unshare may have raced with a long-running agent operation
 *
 * Expects:
 * - The caller has already passed workspace membership checks
 * - `workspaceId` is the principal used for Gateway routing
 *
 * Returns:
 * - Structured `DEVICE_NOT_FOUND` context when the visible registry row no longer exists
 */
export const resolveDeviceDispatchAuthorizationFailure = async (
  serverDB: LobeChatDatabase | undefined,
  userId: string,
  deviceId: string,
  workspaceId?: string,
): Promise<DeviceUnavailableErrorData | undefined> => {
  if (!workspaceId) return undefined;

  const device = serverDB
    ? await new DeviceModel(serverDB, userId, workspaceId).findWorkspaceDeviceById(deviceId)
    : undefined;
  if (device) return undefined;

  return {
    code: 'DEVICE_NOT_FOUND',
    deviceId,
    retryable: true,
    scope: 'workspace',
    workspaceId,
  };
};
