import { type BuiltinServerRuntimeOutput } from '@lobechat/types';

import { type DeviceAttachment, toAvailableDevices } from './types';

export interface RemoteDeviceRuntimeService {
  queryDeviceList: () => Promise<DeviceAttachment[]>;
  /**
   * Called when the model activates a device that is not online. A host that
   * can start the device (a managed cloud device) starts it, then returns
   * `'online'` when it came online (the list is read again), `'starting'` when
   * it accepted the start (the device is activated now: it is always online
   * for the model, and its tool calls wait for it), or the result to report
   * instead. Returning `undefined` keeps the default offline answer.
   */
  resolveOfflineDevice?: (
    deviceId: string,
  ) => Promise<BuiltinServerRuntimeOutput | 'online' | 'starting' | undefined>;
}

export class RemoteDeviceExecutionRuntime {
  private service: RemoteDeviceRuntimeService;

  constructor(service: RemoteDeviceRuntimeService) {
    this.service = service;
  }

  async listOnlineDevices(): Promise<BuiltinServerRuntimeOutput> {
    try {
      // Managed cloud devices are always online for the model, even asleep.
      const onlineDevices = toAvailableDevices(await this.service.queryDeviceList());

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
      const findDevice = async () =>
        (await this.service.queryDeviceList()).find((d) => d.deviceId === args.deviceId);
      const device = await findDevice();
      let target = device?.online ? device : undefined;
      let starting = false;

      if (!target) {
        const resolved = await this.service.resolveOfflineDevice?.(args.deviceId);
        if (resolved === 'online') {
          const fresh = await findDevice();
          target = fresh?.online ? fresh : undefined;
        } else if (resolved === 'starting') {
          // Report the cloud device as online, the way the device list does.
          target = device && { ...device, online: true };
          starting = !!target;
        } else if (resolved) return resolved;
      }

      if (!target) {
        // The device list can go stale between listOnlineDevices and this call
        // (a device that showed online may have dropped in between), so point
        // the model at refreshing the list instead of leaving it with a dead
        // end — repeated blind activateDevice retries against the same stale
        // id are the observed failure mode (agent vent reports).
        return {
          content: `Device "${args.deviceId}" is not online or does not exist. Call listOnlineDevices to refresh the device list and activate a device from the fresh result. If no device is online, tell the user to connect the desktop application or cli.`,
          success: false,
        };
      }

      const name = target.friendlyName || target.hostname;
      return {
        content: starting
          ? `Device "${name}" (${target.platform}) activated successfully. It is a cloud device that is starting now; Local System tools are available, and the first call may take a little longer while it starts.`
          : `Device "${name}" (${target.platform}) activated successfully. Local System tools are now available.`,
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
