import { isDesktop } from '@lobechat/const';
import type { DeviceListItem } from '@lobechat/types';
import { useCallback } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { deviceSelectors } from './selectors';
import { useDeviceStore } from './store';

export interface DeviceListResult {
  /** Every device of the active scope, or `undefined` until storage or the server answers. */
  data: DeviceListItem[] | undefined;
  error: unknown;
  /**
   * The server answered this session. Until then `data` is a persisted copy
   * that may be stale or miss rows, so "no device" / "not found" is pending,
   * not a fact.
   */
  isConfirmed: boolean;
  /** Nothing to show yet: no usable copy and the request is in flight. */
  isLoading: boolean;
  /** A request is in flight. Never a reason to hide `data`. */
  isValidating: boolean;
  /** Re-fetch, then resolve with the rows now in the store. */
  mutate: () => Promise<DeviceListItem[] | undefined>;
}

/**
 * The device list, read from the device store's replica. ALWAYS use this (or
 * `useFetchDevices` + `deviceSelectors`) for any surface that lists or
 * resolves devices — never `lambdaQuery.device.listDevices` or a second fetch.
 * One request per scope feeds every reader, and the replica is partitioned by
 * user + workspace, so switching workspaces never serves the previous pool.
 *
 * A reload paints the persisted copy first. Its rows carry `onlineUnknown`
 * (stored as offline, no channels) until the server confirms them, so a
 * surface that shows or acts on presence must treat those rows as unknown
 * rather than offline (`isDevicePresenceUnknown`).
 *
 * Devices come from an authed lambda procedure, so only query once signed in
 * (desktop always queries — it lists the local device's registered cwd).
 * A live surface that must track presence passes its own `refreshInterval`.
 */
export const useDeviceList = (config?: { refreshInterval?: number }): DeviceListResult => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const enabled = isLogin || isDesktop;
  const { error, isValidating } = useDeviceStore((s) => s.useFetchDevices)(enabled, config);
  const isLoaded = useDeviceStore(deviceSelectors.isDeviceListLoaded);
  const isConfirmed = useDeviceStore(deviceSelectors.isDeviceListConfirmed);
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const refreshDevices = useDeviceStore((s) => s.refreshDevices);

  const mutate = useCallback(async () => {
    await refreshDevices();
    const state = useDeviceStore.getState();
    return deviceSelectors.isDeviceListLoaded(state)
      ? deviceSelectors.deviceList(state)
      : undefined;
  }, [refreshDevices]);

  // A restored empty list says nothing about the server: keep it pending so no
  // surface renders onboarding off it, and a failed refresh still surfaces its
  // error instead of settling on the empty snapshot.
  const hasData = isLoaded && (isConfirmed || devices.length > 0);

  return {
    data: hasData ? devices : undefined,
    error,
    isConfirmed,
    isLoading: enabled && !hasData && (!error || isValidating),
    isValidating,
    mutate,
  };
};

/**
 * The row came from the persisted copy and the server has not confirmed it
 * yet: its `online: false` is a placeholder, not a fact.
 */
export const isDevicePresenceUnknown = (device: Pick<DeviceListItem, 'onlineUnknown'>): boolean =>
  !!device.onlineUnknown;
