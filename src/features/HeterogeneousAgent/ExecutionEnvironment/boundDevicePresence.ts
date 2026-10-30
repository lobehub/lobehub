import type { DeviceListItem } from '@lobechat/types';

import { isDevicePresenceUnknown } from '@/store/device';

/**
 * What the remote agent card says about its bound device.
 *
 * Returns:
 * - `none` when nothing is bound
 * - `checking` while the device list is still the stored copy and either
 *   lacks the device (it may be newer than the copy, or past its row cap) or
 *   holds it with unknown presence
 * - `missing` once the server confirmed the list without the device
 * - `online` / `offline` from a confirmed row
 */
export const getBoundDevicePresence = (
  boundDeviceId: string | undefined,
  boundDevice: Pick<DeviceListItem, 'online' | 'onlineUnknown'> | undefined,
  isConfirmed: boolean,
): 'checking' | 'missing' | 'none' | 'offline' | 'online' => {
  if (!boundDeviceId) return 'none';
  if (!boundDevice) return isConfirmed ? 'missing' : 'checking';
  if (isDevicePresenceUnknown(boundDevice)) return 'checking';
  return boundDevice.online ? 'online' : 'offline';
};

/**
 * State of the change-device select, which only offers online devices.
 *
 * Returns:
 * - `error` when the unconfirmed list's request failed and no retry is in
 *   flight — show why and offer a retry instead of an endless spinner
 * - `loading` while the list is still the stored copy (its presence is not
 *   known, and it may lack devices) or any stored row has unknown presence
 * - `ready` once the server confirmed the list
 */
export const getDeviceSelectState = ({
  error,
  hasUnknownPresence,
  isConfirmed,
  isLoading,
  isValidating,
}: {
  error: unknown;
  hasUnknownPresence: boolean;
  isConfirmed: boolean;
  isLoading: boolean;
  isValidating: boolean;
}): 'error' | 'loading' | 'ready' => {
  if (!isConfirmed && error && !isValidating) return 'error';
  if (isLoading || !isConfirmed || hasUnknownPresence) return 'loading';
  return 'ready';
};
