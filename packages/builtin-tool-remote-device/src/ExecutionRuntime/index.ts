import { type BuiltinServerRuntimeOutput } from '@lobechat/types';

import { type DeviceAttachment } from './types';

export interface RemoteDeviceRuntimeService {
  queryDeviceList: () => Promise<DeviceAttachment[]>;
}

export class RemoteDeviceExecutionRuntime {
  private service: RemoteDeviceRuntimeService;

  constructor(service: RemoteDeviceRuntimeService) {
    this.service = service;
  }

  async listOnlineDevices(): Promise<BuiltinServerRuntimeOutput> {
    try {
      const devices = await this.service.queryDeviceList();
      const onlineDevices = devices.filter((d) => d.online);

      return {
        content:
          onlineDevices.length > 0
            ? JSON.stringify(onlineDevices)
            : 'No online devices found. Please make sure your desktop application is running and connected.',
        state: { devices: onlineDevices },
        success: true,
      };
    } catch (error) {
      return {
        content: `Failed to list devices: ${error instanceof Error ? error.message : String(error)}`,
        error,
        success: false,
      };
    }
  }

  async activateDevice(args: { deviceId: string }): Promise<BuiltinServerRuntimeOutput> {
    try {
      const devices = await this.service.queryDeviceList();
      const target = devices.find((d) => d.deviceId === args.deviceId && d.online);

      if (!target) {
        return {
          content: `Device "${args.deviceId}" is not online or does not exist.`,
          success: false,
        };
      }

      return {
        content: `Device "${target.hostname}" (${target.platform}) activated successfully. Local System tools are now available.`,
        state: {
          activatedDevice: target,
          metadata: { activeDeviceId: args.deviceId },
        },
        success: true,
      };
    } catch (error) {
      return {
        content: `Failed to activate device: ${error instanceof Error ? error.message : String(error)}`,
        error,
        success: false,
      };
    }
  }
}
