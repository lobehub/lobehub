import type { DeviceListItem } from '@lobechat/types';

/**
 * Whether a device row is this desktop itself. A workspace row shared as
 * public is a team device, not "this machine" (same rule as
 * `findOwnWorkspaceDevice`), even when this machine enrolled it.
 */
export const isThisComputerDevice = (device: DeviceListItem, localMachineIds: string[]) =>
  localMachineIds.includes(device.deviceId) &&
  !(device.scope === 'workspace' && device.visibility === 'public');

/**
 * Splits the picker's device rows into this machine's own rows and every other
 * machine. `localMachineIds` are the ids this desktop holds
 * (`useLocalMachineDeviceIds`), empty off-desktop — so web and mobile keep every
 * row under its machine name, where each one really is remote. A public
 * workspace row is a shared team device, so it is listed with the others even
 * when this machine enrolled it.
 *
 * Of this machine's rows only the one that stands in for it stays visible: the
 * workspace row it runs through (`ownWorkspaceDeviceId`), or whichever row is
 * the active pick. Others are dropped — the "This computer" row already covers
 * running here, and a second row naming the same machine reads as a remote.
 */
export const splitThisComputerDevices = (
  devices: DeviceListItem[],
  {
    activeDeviceId,
    localMachineIds,
    ownWorkspaceDeviceId,
  }: {
    activeDeviceId?: string;
    localMachineIds: string[];
    ownWorkspaceDeviceId?: string;
  },
): { otherDevices: DeviceListItem[]; thisComputerDevices: DeviceListItem[] } => {
  const thisComputerDevices: DeviceListItem[] = [];
  const otherDevices: DeviceListItem[] = [];

  for (const device of devices) {
    if (!isThisComputerDevice(device, localMachineIds)) {
      otherDevices.push(device);
      continue;
    }
    if (device.deviceId === ownWorkspaceDeviceId || device.deviceId === activeDeviceId)
      thisComputerDevices.push(device);
  }

  return { otherDevices, thisComputerDevices };
};
