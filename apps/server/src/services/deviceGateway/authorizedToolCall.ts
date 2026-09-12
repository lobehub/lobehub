import type { LobeChatDatabase } from '@lobechat/database';
import type { DeviceToolCallResult } from '@lobechat/device-gateway-client';

import { resolveDeviceDispatchAuthorizationFailure } from './dispatchAuthorization';
import { deviceGateway } from './index';

/**
 * Executes a device tool call after a last-moment workspace registry check.
 *
 * Use when:
 * - An Agent runtime dispatches new work to its active device
 *
 * Expects:
 * - `workspaceId`, when present, is the same principal used during target selection
 *
 * Returns:
 * - The Gateway result, or immediate structured `DEVICE_NOT_FOUND` after Unshare
 */
export const executeAuthorizedDeviceToolCall = async (
  serverDB: LobeChatDatabase | undefined,
  params: { deviceId: string; operationId?: string; userId: string; workspaceId?: string },
  toolCall: { apiName: string; arguments: string; identifier: string },
  timeout?: number,
): Promise<DeviceToolCallResult> => {
  const errorData = await resolveDeviceDispatchAuthorizationFailure(
    serverDB,
    params.userId,
    params.deviceId,
    params.workspaceId,
    params.operationId,
  );
  if (errorData) {
    return {
      content: 'The device is no longer authorized for this run.',
      error: 'DEVICE_NOT_FOUND',
      errorData,
      success: false,
    };
  }

  return deviceGateway.executeToolCall(params, toolCall, timeout);
};
