import { lambdaClient } from '@/libs/trpc/client';

class DeviceService {
  /**
   * Check whether a path exists on a device and is a directory (via the device's
   * `statPath` RPC). Returns `null` when the device is unreachable — callers
   * treat "can't verify" as non-blocking.
   */
  async statPath(deviceId: string, path: string) {
    return lambdaClient.device.statPath.query({ deviceId, path });
  }
}

export const deviceService = new DeviceService();
