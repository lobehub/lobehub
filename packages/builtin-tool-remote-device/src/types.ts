import { type DeviceAttachment } from './ExecutionRuntime/types';

export const RemoteDeviceIdentifier = 'lobe-remote-device';

export const RemoteDeviceApiName = {
  activateDevice: 'activateDevice',
  listOnlineDevices: 'listOnlineDevices',
} as const;

export type RemoteDeviceApiNameType =
  (typeof RemoteDeviceApiName)[keyof typeof RemoteDeviceApiName];

/** Plugin state produced by the `listOnlineDevices` API. */
export interface ListOnlineDevicesState {
  devices?: DeviceAttachment[];
}

/** Arguments accepted by the `activateDevice` API. */
export interface ActivateDeviceParams {
  deviceId: string;
}

/** Plugin state produced by the `activateDevice` API. */
export interface ActivateDeviceState {
  activatedDevice?: DeviceAttachment;
  metadata?: { activeDeviceId?: string };
}
