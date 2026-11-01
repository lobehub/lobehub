/**
 * Remote desktop-app and CLI update RPCs.
 */
import type {
  DeviceAppUpdateFailure,
  DeviceAppUpdateInstallResult,
  DeviceAppUpdateState,
  DeviceAppUpdateStateResult,
  DeviceCliRestartParams,
  DeviceCliUpdateState,
  DeviceCliUpdateStateResult,
} from '@lobechat/types';
import debug from 'debug';

import type { DeviceClientGetter } from './types';

const log = debug('lobe-server:device-gateway');

/** Scope every remote update RPC carries. */
export interface AppUpdateRpcParams {
  deviceId: string;
  timeout?: number;
  userId: string;
  workspaceId?: string;
}

/** Where the device's desktop app update stands; never checks on its own. */
export async function getAppUpdateState(
  getClient: DeviceClientGetter,
  params: AppUpdateRpcParams,
): Promise<DeviceAppUpdateStateResult> {
  const result = await invokeAppUpdate<DeviceAppUpdateState>(
    getClient,
    'getAppUpdateState',
    params,
  );
  return result.status === 'ok' ? { state: result.data, status: 'ok' } : result;
}

/** Start an update check on the device; a found update downloads on its own. */
export async function checkAppUpdate(
  getClient: DeviceClientGetter,
  params: AppUpdateRpcParams,
): Promise<DeviceAppUpdateStateResult> {
  const result = await invokeAppUpdate<DeviceAppUpdateState>(getClient, 'checkAppUpdate', params);
  return result.status === 'ok' ? { state: result.data, status: 'ok' } : result;
}

/** Restart the device's desktop app into its downloaded update. */
export async function installAppUpdate(
  getClient: DeviceClientGetter,
  params: AppUpdateRpcParams,
): Promise<DeviceAppUpdateInstallResult> {
  const result = await invokeAppUpdate<{ targetVersion: string }>(
    getClient,
    'installAppUpdate',
    params,
  );
  return result.status === 'ok'
    ? { status: 'ok', targetVersion: result.data.targetVersion }
    : result;
}

/**
 * Shared relay for the remote app-update RPCs. Only the desktop app can
 * update itself, so the call asks for the `desktop` channel; an older gateway
 * may still hand it to `lh connect` on the same machine, whose rejection is
 * reported as `unsupported` like an outdated desktop's.
 */
export async function invokeAppUpdate<T>(
  getClient: DeviceClientGetter,
  method: 'checkAppUpdate' | 'getAppUpdateState' | 'installAppUpdate',
  params: AppUpdateRpcParams,
): Promise<{ data: T; status: 'ok' } | { message: string; status: DeviceAppUpdateFailure }> {
  const { deviceId, timeout = 15_000, userId, workspaceId } = params;
  const client = getClient();
  if (!client) return { message: 'Device Gateway is not configured', status: 'unavailable' };

  try {
    const result = await client.invokeRpc<T>(
      { channel: 'desktop', deviceId, timeout, userId, workspaceId },
      { method },
    );
    if (result.success && result.data !== undefined) return { data: result.data, status: 'ok' };

    const message = result.error || `${method} failed`;
    log('%s: failed for deviceId=%s — %s', method, deviceId, message);
    const unsupported =
      message.includes('does not support remote updates') ||
      message.includes('Unknown device RPC method');
    return { message, status: unsupported ? 'unsupported' : 'unavailable' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('%s: error for deviceId=%s — %s', method, deviceId, message);
    return { message, status: 'unavailable' };
  }
}

export async function getCliUpdateState(
  getClient: DeviceClientGetter,
  params: AppUpdateRpcParams,
): Promise<DeviceCliUpdateStateResult> {
  return invokeCliUpdate(getClient, 'getCliUpdateState', params);
}

export async function checkCliUpdate(
  getClient: DeviceClientGetter,
  params: AppUpdateRpcParams,
): Promise<DeviceCliUpdateStateResult> {
  return invokeCliUpdate(getClient, 'checkCliUpdate', params);
}

export async function restartCli(
  getClient: DeviceClientGetter,
  params: AppUpdateRpcParams & DeviceCliRestartParams,
): Promise<DeviceCliUpdateStateResult> {
  return invokeCliUpdate(getClient, 'restartCli', params, {
    requestId: params.requestId,
    update: params.update,
  });
}

export async function invokeCliUpdate(
  getClient: DeviceClientGetter,
  method: 'getCliUpdateState' | 'checkCliUpdate' | 'restartCli',
  params: AppUpdateRpcParams,
  restartParams?: DeviceCliRestartParams,
): Promise<DeviceCliUpdateStateResult> {
  const { deviceId, timeout = 15_000, userId, workspaceId } = params;
  const client = getClient();
  if (!client) return { message: 'Device Gateway is not configured', status: 'unavailable' };

  try {
    const result = await client.invokeRpc<DeviceCliUpdateState>(
      { channel: 'cli', deviceId, timeout, userId, workspaceId },
      { method, ...(restartParams ? { params: restartParams } : {}) },
    );
    if (result.success && result.data !== undefined) return { state: result.data, status: 'ok' };

    const message = result.error || `${method} failed`;
    const unsupported =
      message.includes('does not support remote CLI updates') ||
      message.includes('Unknown device RPC method');
    log('%s: failed for deviceId=%s — %s', method, deviceId, message);
    return {
      message: message.replace('CLI_MAINTENANCE_REJECTED: ', ''),
      status: unsupported
        ? 'unsupported'
        : message.startsWith('CLI_MAINTENANCE_REJECTED: ')
          ? 'rejected'
          : 'unavailable',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('%s: error for deviceId=%s — %s', method, deviceId, message);
    return { message, status: 'unavailable' };
  }
}
