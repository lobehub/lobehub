import type { DeviceListItem } from '@lobechat/types';

/**
 * The execution-environment category a device belongs to, named with the same
 * keys the device switcher groups by: this desktop, a private device, or a
 * workspace device. One machine can be several of these at once (its personal
 * and workspace identities), which is exactly when the name alone is not
 * enough. Unknown devices get no category rather than a guessed one.
 */
export const deviceCategoryKey = (
  deviceId: string,
  devices: DeviceListItem[] | undefined,
  currentDeviceId: string | undefined,
) => {
  if (deviceId === currentDeviceId) return 'heteroAgent.executionTarget.local' as const;
  const device = devices?.find((item) => item.deviceId === deviceId);
  if (!device) return;
  return device.scope === 'workspace'
    ? ('heteroAgent.executionTarget.workspaceGroup' as const)
    : ('heteroAgent.executionTarget.personalGroup' as const);
};

export const deviceDisplayName = (deviceId: string, devices: DeviceListItem[] | undefined) => {
  const device = devices?.find((item) => item.deviceId === deviceId);
  return device?.friendlyName || device?.hostname || deviceId;
};
