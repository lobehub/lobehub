import type { DeviceListItem } from '@lobechat/types';

/**
 * Splits the picker's device rows into this machine's own rows and every other
 * machine. `localMachineIds` are the ids this desktop holds
 * (`useLocalMachineDeviceIds`), empty off-desktop — so web and mobile keep every
 * row under its machine name, where each one really is remote.
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
    if (!localMachineIds.includes(device.deviceId)) {
      otherDevices.push(device);
      continue;
    }
    if (device.deviceId === ownWorkspaceDeviceId || device.deviceId === activeDeviceId)
      thisComputerDevices.push(device);
  }

  return { otherDevices, thisComputerDevices };
};
