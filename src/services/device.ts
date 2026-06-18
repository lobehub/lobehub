import { lambdaClient } from '@/libs/trpc/client';

type DeviceClient = typeof lambdaClient.device;

/**
 * Single chokepoint for the `device` TRPC router. Components, hooks and stores
 * should call this instead of reaching into `lambdaClient.device.*` directly.
 */
class DeviceService {
  /** All devices the user has registered (incl. offline) + live gateway sessions. */
  listDevices() {
    return lambdaClient.device.listDevices.query();
  }

  /** Update user-editable device fields (defaultCwd / friendlyName / workingDirs). */
  updateDevice(input: Parameters<DeviceClient['updateDevice']['mutate']>[0]) {
    return lambdaClient.device.updateDevice.mutate(input);
  }

  /**
   * Check whether a path exists on a device and is a directory (via the device's
   * `statPath` RPC). Returns `null` when the device is unreachable — callers
   * treat "can't verify" as non-blocking.
   */
  statPath(deviceId: string, path: string) {
    return lambdaClient.device.statPath.query({ deviceId, path });
  }

  /** Probe whether an agent platform (openclaw / hermes) is available on a device. */
  checkCapability(input: Parameters<DeviceClient['checkCapability']['query']>[0]) {
    return lambdaClient.device.checkCapability.query(input);
  }

  /** Fetch the agent profile (title / description / avatar) from a device platform. */
  getAgentProfile(input: Parameters<DeviceClient['getAgentProfile']['query']>[0]) {
    return lambdaClient.device.getAgentProfile.query(input);
  }
}

export const deviceService = new DeviceService();
