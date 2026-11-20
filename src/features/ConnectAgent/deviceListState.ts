import type { DeviceListItem } from '@lobechat/types';

export type DeviceListState = 'empty' | 'error' | 'loading' | 'ready';

interface GetDeviceListStateOptions {
  /** The last device-list request failed. */
  error?: unknown;
  hasDevices: boolean;
  /**
   * The server answered this session. A stored copy without rows for this
   * pool may be stale or capped, so it is not proof the pool is empty.
   */
  isConfirmed: boolean;
  isFetching: boolean;
}

export const getDeviceListState = ({
  error,
  hasDevices,
  isConfirmed,
  isFetching,
}: GetDeviceListStateOptions): DeviceListState => {
  if (hasDevices) return 'ready';
  if (isFetching) return 'loading';
  // Unconfirmed and the request failed: say so instead of an endless skeleton.
  if (!isConfirmed) return error ? 'error' : 'loading';
  return 'empty';
};

/**
 * Whether the picker would list this device: inside a workspace only the
 * workspace's own devices are connectable.
 */
export const isListableDevice = (device: DeviceListItem, restrictToWorkspace: boolean) =>
  !restrictToWorkspace || device.scope === 'workspace';
