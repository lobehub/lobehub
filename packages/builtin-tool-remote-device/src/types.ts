export const RemoteDeviceIdentifier = 'lobe-remote-device';

export const RemoteDeviceApiName = {
  activateDevice: 'activateDevice',
  listOnlineDevices: 'listOnlineDevices',
} as const;

export type RemoteDeviceApiNameType =
  (typeof RemoteDeviceApiName)[keyof typeof RemoteDeviceApiName];
