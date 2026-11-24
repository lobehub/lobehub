import { isDesktop } from '@lobechat/const';
import type { DeviceListItem } from '@lobechat/types';
import { useMemo } from 'react';

import { useLocalMachineDeviceIds } from '@/hooks/useLocalMachineDeviceIds';
import { isDevicePresenceUnknown } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { electronGatewaySelectors } from '@/store/electron/selectors';

/** How the app recognises the machine it runs on among the listed devices. */
export interface CurrentMachine {
  hostname?: string;
  /**
   * Every id this machine holds: its resolved stable id, the gateway's reported
   * one (they differ before the gateway connects), and its row in the active
   * workspace.
   */
  ids: string[];
}

const NO_MACHINE: CurrentMachine = { ids: [] };

/**
 * This desktop's identity, for every picker that lists devices: one place that
 * loads it, so no picker reads a gateway id nobody fetched and lists this
 * machine twice. Empty on web.
 */
export const useCurrentMachine = (): CurrentMachine => {
  useElectronStore((s) => s.useFetchGatewayStableDeviceId)();
  const localIds = useLocalMachineDeviceIds();
  const hostname = useElectronStore((s) => s.gatewayDeviceInfo?.hostname);
  const stableId = useElectronStore(electronGatewaySelectors.gatewayStableDeviceId);

  return useMemo(() => {
    if (!isDesktop) return NO_MACHINE;
    const ids = [stableId, ...localIds].filter((id): id is string => !!id);
    return { hostname, ids: [...new Set(ids)] };
  }, [hostname, localIds, stableId]);
};

/**
 * Whether a listed device is this machine. The id is the reliable signal; the
 * hostname covers a row enrolled under an identity this desktop has not
 * resolved yet, and only while online, so a stale row of an old install is not
 * mistaken for the running one.
 */
export const isCurrentMachineDevice = (device: DeviceListItem, machine: CurrentMachine): boolean =>
  machine.ids.includes(device.deviceId) ||
  (!!machine.hostname && device.online && device.hostname === machine.hostname);

/** A device that is known to be offline — not one still waiting on its first presence check. */
export const isDeviceOffline = (device: DeviceListItem): boolean =>
  !device.online && !isDevicePresenceUnknown(device);

export interface PickerDevices {
  /** Online (or still being checked) devices, this machine first. */
  available: DeviceListItem[];
  /** This machine's row, when it is listed. */
  current?: DeviceListItem;
  /** Offline devices, which pickers fold away by default. */
  offline: DeviceListItem[];
}

/** Splits a device list the way every picker shows it: this machine, then reachable, then offline. */
export const splitPickerDevices = (
  devices: DeviceListItem[],
  machine: CurrentMachine,
): PickerDevices => {
  const current =
    devices.find((device) => machine.ids.includes(device.deviceId)) ??
    devices.find((device) => isCurrentMachineDevice(device, machine));
  const rest = devices.filter((device) => device !== current);

  return {
    available: [
      ...(current && !isDeviceOffline(current) ? [current] : []),
      ...rest.filter((device) => !isDeviceOffline(device)),
    ],
    current,
    offline: [
      ...(current && isDeviceOffline(current) ? [current] : []),
      ...rest.filter(isDeviceOffline),
    ],
  };
};
