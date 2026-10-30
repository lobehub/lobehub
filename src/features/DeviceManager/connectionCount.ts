import type { DeviceListItem, DeviceScope } from '@lobechat/types';

import type { DeviceListResult } from '@/store/device';

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
 * - The number of live connections in the requested scope and optional device,
 *   or `undefined` while a matching row is still the persisted copy
 *   (`onlineUnknown`), whose empty channels are a placeholder, not a count
 */
export const getScopedConnectionCount = (
  devices: DeviceListItem[] | undefined,
  scope: DeviceScope,
  deviceId?: string,
): number | undefined => {
  if (!devices) return undefined;

  const matched = devices.filter(
    (device) => device.scope === scope && (!deviceId || device.deviceId === deviceId),
  );
  if (matched.some((device) => device.onlineUnknown)) return undefined;

  return matched.reduce((count, device) => count + device.channels.length, 0);
};

/**
 * Resolves the workspace presence state without treating a failed lookup as offline.
 *
 * Use when:
 * - A workspace-scoped surface summarizes device presence from an asynchronous list
 * - Cached presence may remain available while background revalidation fails
 *
 * Expects:
 * - The `useDeviceList` result, already scoped to the active workspace
 *
 * Returns:
 * - A presentation state that distinguishes unavailable data from an authoritative empty list.
 *   Until the server confirms the list, a restored copy says nothing: its
 *   workspace rows carry unknown presence, and a copy without any (stale, or
 *   past the persisted-row cap) is not proof the pool is empty.
 */
export const getWorkspaceConnectionState = ({
  data: devices,
  error,
  isConfirmed,
  isLoading,
}: Pick<DeviceListResult, 'data' | 'error' | 'isConfirmed' | 'isLoading'>):
  'connected' | 'connecting' | 'disconnected' | 'unavailable' => {
  if (!devices && error) return 'unavailable';
  if (!devices && isLoading) return 'connecting';

  const count = getScopedConnectionCount(devices, 'workspace');
  if (devices && (count === undefined || !isConfirmed)) return error ? 'unavailable' : 'connecting';

  return count ? 'connected' : 'disconnected';
};

/**
 * What a device with no live connection says about it.
 *
 * Returns:
 * - `checking` for a persisted row the server has not confirmed yet
 *   (`onlineUnknown`): its empty channels are a placeholder, not "offline"
 * - `offline` once the server reported the device without a connection
 */
export const getIdleConnectionStatus = (
  device: Pick<DeviceListItem, 'onlineUnknown'>,
): 'checking' | 'offline' => (device.onlineUnknown ? 'checking' : 'offline');
