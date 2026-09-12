import type { LobeChatDatabase } from '@lobechat/database';
import type { DeviceUnavailableErrorData } from '@lobechat/types';

import { DeviceModel } from '@/database/models/device';

import { DevicePoolAccessService } from './poolAccess';

/**
 * Rechecks durable run identity and current pool grants immediately before device dispatch.
 *
 * Use when:
 * - A previously selected workspace device is about to receive new work
 * - Unshare may have raced with a long-running agent operation
 *
 * Expects:
 * - operationId identifies server-authored provenance; missing provenance denies
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
  operationId?: string,
): Promise<DeviceUnavailableErrorData | undefined> => {
  const enabled = serverDB
    ? await new DevicePoolAccessService(serverDB, userId, workspaceId).isEnabled()
    : false;
  if (!enabled) {
    if (!workspaceId) return undefined;
    if (
      serverDB &&
      (await new DeviceModel(serverDB, userId, workspaceId).findWorkspaceDeviceById(deviceId))
    )
      return undefined;
  }
  if (enabled && serverDB && operationId) {
    const access = new DevicePoolAccessService(serverDB, userId, workspaceId);
    const context = await access.loadContext(operationId);
    const grants = context ? await access.authorizedDevices(context) : [];
    if (grants.some((grant) => grant.device.deviceId === deviceId)) return undefined;
  }

  return {
    code: 'DEVICE_NOT_FOUND',
    deviceId,
    retryable: true,
    scope: workspaceId ? 'workspace' : 'personal',
    workspaceId,
  };
};
