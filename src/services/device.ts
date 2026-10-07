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

  /**
   * Reads capabilities reported by the authenticated live connector.
   *
   * Use when: enabling features that older device clients do not implement.
   * Expects: a device accessible in the current workspace.
   * Returns: live system information, or undefined when unavailable.
   */
  getSystemInfo(deviceId: string) {
    return lambdaClient.device.getDeviceSystemInfo.query({ deviceId });
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

  /** Ports the device is listening on; `null` when it can't answer. */
  listListeningPorts(input: Parameters<DeviceClient['listListeningPorts']['query']>[0]) {
    return lambdaClient.device.listListeningPorts.query(input);
  }

  /** Where the device's desktop app update stands; never starts a check. */
  getAppUpdateState(input: Parameters<DeviceClient['getAppUpdateState']['query']>[0]) {
    return lambdaClient.device.getAppUpdateState.query(input);
  }

  /** Start an update check on the device; a found update downloads on its own. */
  checkAppUpdate(input: Parameters<DeviceClient['checkAppUpdate']['mutate']>[0]) {
    return lambdaClient.device.checkAppUpdate.mutate(input);
  }

  /** Restart the device's desktop app into its downloaded update. */
  installAppUpdate(input: Parameters<DeviceClient['installAppUpdate']['mutate']>[0]) {
    return lambdaClient.device.installAppUpdate.mutate(input);
  }

  /** Read CLI maintenance state without checking the release registry. */
  getCliUpdateState(input: Parameters<DeviceClient['getCliUpdateState']['query']>[0]) {
    return lambdaClient.device.getCliUpdateState.query(input);
  }

  checkCliUpdate(input: Parameters<DeviceClient['checkCliUpdate']['mutate']>[0]) {
    return lambdaClient.device.checkCliUpdate.mutate(input);
  }

  restartCli(input: Parameters<DeviceClient['restartCli']['mutate']>[0]) {
    return lambdaClient.device.restartCli.mutate(input);
  }

  /**
   * Interactive terminal on the device. `createTerminalSession` opens a PTY and
   * the rest drive it: `writeTerminal` for input, `readTerminal` to drain
   * output from a cursor, `resizeTerminal` when the panel changes size and
   * `closeTerminal` to end it. Polling rather than streaming is deliberate —
   * see `@lobechat/device-control`'s terminal types.
   */
  createTerminalSession(input: Parameters<DeviceClient['createTerminalSession']['mutate']>[0]) {
    return lambdaClient.device.createTerminalSession.mutate(input);
  }

  writeTerminal(input: Parameters<DeviceClient['writeTerminal']['mutate']>[0]) {
    return lambdaClient.device.writeTerminal.mutate(input);
  }

  readTerminal(input: Parameters<DeviceClient['readTerminal']['mutate']>[0]) {
    return lambdaClient.device.readTerminal.mutate(input);
  }

  resizeTerminal(input: Parameters<DeviceClient['resizeTerminal']['mutate']>[0]) {
    return lambdaClient.device.resizeTerminal.mutate(input);
  }

  closeTerminal(input: Parameters<DeviceClient['closeTerminal']['mutate']>[0]) {
    return lambdaClient.device.closeTerminal.mutate(input);
  }

  /** The device's recent CPU / memory / load history, bucketed for charting. */
  getMetricSeries(deviceId: string) {
    return lambdaClient.deviceMetric.getSeries.query({ deviceId });
  }

  /** Revoke a link. */
  revokeTunnel(input: Parameters<DeviceClient['revokeTunnel']['mutate']>[0]) {
    return lambdaClient.device.revokeTunnel.mutate(input);
  }
}

export const deviceService = new DeviceService();
