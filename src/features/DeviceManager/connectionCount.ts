import type { DeviceListItem, DeviceScope } from '@lobechat/types';

/**
 * Counts live connections within one principal scope.
 *
 * Use when:
 * - A scope-level control summarizes all authorized device presence
 * - A personal control needs the count for one logical device
 *
 * Expects:
 * - Device channels were already filtered by the server for the active principal
 *
 * Returns:
 * - The number of live connections in the requested scope and optional device
 */
export const getScopedConnectionCount = (
  devices: DeviceListItem[] | undefined,
  scope: DeviceScope,
  deviceId?: string,
): number | undefined => {
  if (!devices) return undefined;

  return devices
    .filter((device) => device.scope === scope && (!deviceId || device.deviceId === deviceId))
    .reduce((count, device) => count + device.channels.length, 0);
};

/**
 * Resolves the workspace presence state without treating a failed lookup as offline.
 *
 * Use when:
 * - A workspace-scoped surface summarizes device presence from an asynchronous list
 * - Cached presence may remain available while background revalidation fails
 *
 * Expects:
 * - `devices` is already scoped to the active workspace by the caller's data hook
 *
 * Returns:
 * - A presentation state that distinguishes unavailable data from an authoritative empty list
 */
export const getWorkspaceConnectionState = (
  devices: DeviceListItem[] | undefined,
  isLoading: boolean,
  error: unknown,
): 'connected' | 'connecting' | 'disconnected' | 'unavailable' => {
  if (!devices && error) return 'unavailable';
  if (!devices && isLoading) return 'connecting';

  return getScopedConnectionCount(devices, 'workspace') ? 'connected' : 'disconnected';
};
