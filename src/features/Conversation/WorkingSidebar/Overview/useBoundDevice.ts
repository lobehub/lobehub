import type { DeviceListItem } from '@lobechat/types';

import { useDeviceList } from '@/features/DeviceManager/useDeviceList';

/** Re-reads presence so a device that drops or reconnects shows it without a refocus. */
export const PRESENCE_REFRESH_INTERVAL_MS = 30_000;

export type BoundDeviceState =
  | { status: 'loading' }
  | { retry: () => void; status: 'error' }
  /** Loaded, and the device is not in the list: it was removed or never shared. */
  | { status: 'absent' }
  | { device: DeviceListItem; status: 'ready' };

/**
 * The device a topic is bound to, kept live while the Overview is on screen.
 * The device list does not poll on its own, so without this a device that
 * disconnects keeps its old presence until the window is refocused.
 *
 * A failed read is kept apart from a missing device, so the section can offer
 * a retry instead of silently disappearing. Cached data wins over a later
 * failed revalidation: the last known state beats an error row.
 */
export const useBoundDevice = (deviceId: string, active: boolean): BoundDeviceState => {
  const {
    data: devices,
    error,
    isLoading,
    mutate,
  } = useDeviceList({
    refreshInterval: active ? PRESENCE_REFRESH_INTERVAL_MS : 0,
  });

  if (devices) {
    const device = devices.find((item) => item.deviceId === deviceId);
    return device ? { device, status: 'ready' } : { status: 'absent' };
  }
  if (error) return { retry: () => void mutate(), status: 'error' };
  if (isLoading) return { status: 'loading' };

  return { status: 'absent' };
};
