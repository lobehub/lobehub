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

  /** Browse folders on the execution device, including cursor pagination. */
  browseDirectory(input: Parameters<DeviceClient['browseDirectory']['query']>[0]) {
    return lambdaClient.device.browseDirectory.query(input);
  }

  /** Probe whether an agent platform (openclaw / hermes) is available on a device. */
  checkCapability(input: Parameters<DeviceClient['checkCapability']['query']>[0]) {
    return lambdaClient.device.checkCapability.query(input);
  }

  /** Fetch the agent profile (title / description / avatar) from a device platform. */
  getAgentProfile(input: Parameters<DeviceClient['getAgentProfile']['query']>[0]) {
    return lambdaClient.device.getAgentProfile.query(input);
  }

  /** Scan a device for every known heterogeneous agent type in one pass. */
  scanAgents(input: Parameters<DeviceClient['scanAgents']['query']>[0]) {
    return lambdaClient.device.scanAgents.query(input);
  }

  /** Live tunnel links, optionally narrowed to one device. */
  listTunnels(input?: Parameters<DeviceClient['listTunnels']['query']>[0]) {
    return lambdaClient.device.listTunnels.query(input);
  }

  /** Expose a port on a device and get back a link, ready to open. */
  createTunnel(input: Parameters<DeviceClient['createTunnel']['mutate']>[0]) {
    return lambdaClient.device.createTunnel.mutate(input);
  }

  /**
   * Mint the one-shot token that opens an existing link. Called per click:
   * tokens are short-lived and never stored alongside the link.
   */
  openTunnel(input: Parameters<DeviceClient['openTunnel']['mutate']>[0]) {
    return lambdaClient.device.openTunnel.mutate(input);
  }

  /** Revoke a link. */
  revokeTunnel(input: Parameters<DeviceClient['revokeTunnel']['mutate']>[0]) {
    return lambdaClient.device.revokeTunnel.mutate(input);
  }
}

export const deviceService = new DeviceService();
