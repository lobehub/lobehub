import type { DeviceListItem, DeviceScope } from '@lobechat/types';
import { isManagedCloudDevice } from '@lobechat/types';

/**
 * How the picker's reconnect control ended:
 * - `connected`: the device is online now.
 * - `starting`: a managed cloud device accepted the wake but is not online
 *   yet. A run bound to it still wakes it and waits.
 * - `failed`: a connected device did not come back.
 */
export type ReconnectOutcome = 'connected' | 'failed' | 'starting';

export interface ReconnectDeviceDeps {
  /** Reconnect this desktop app's own gateway connection. */
  connectGateway: () => Promise<unknown>;
  /** Open a desktop deep link. */
  openDeepLink: (url: string) => void;
  /** Fetch the device list again; resolves with the new list. */
  refreshDevices: () => Promise<DeviceListItem[] | undefined>;
  sleep?: (ms: number) => Promise<void>;
  /** Ask a managed cloud device to start. */
  wakeManagedDevice: (input: { deviceId: string; scope: DeviceScope }) => Promise<unknown>;
}

/** A connected device comes back in seconds once its app gets the deep link. */
export const DEVICE_RECONNECT_POLL = { attempts: 8, intervalMs: 1000 };

/** A managed cloud device can take up to two minutes to start. */
export const MANAGED_DEVICE_WAKE_POLL = { attempts: 40, intervalMs: 3000 };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll the device list until `deviceId` is online. A failed refresh counts as
 * one poll in which the device is not online yet. Resolves `true` once it is
 * online, `false` when the attempts run out or `shouldStop` answers true.
 */
const pollDeviceOnline = async (
  deviceId: string,
  poll: { attempts: number; intervalMs: number },
  {
    refreshDevices,
    shouldStop,
    sleep,
  }: Pick<ReconnectDeviceDeps, 'refreshDevices'> & {
    shouldStop?: () => boolean;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<boolean> => {
  for (let attempt = 0; attempt < poll.attempts; attempt += 1) {
    if (shouldStop?.()) return false;
    let nextDevices: DeviceListItem[] | undefined;
    try {
      nextDevices = await refreshDevices();
    } catch (error) {
      console.warn('Device list refresh failed while waiting for a device:', error);
    }
    if (nextDevices?.some((item) => item.deviceId === deviceId && item.online)) return true;
    await sleep(poll.intervalMs);
  }
  return false;
};

/**
 * Wake a managed cloud device through the server, then poll the device list
 * until it is online (`connected`) or the wait runs out (`starting`). A
 * surface that needs the device, such as the folder picker, calls this
 * without the user pressing "Wake now". A failed wake request throws.
 * `shouldStop` lets a closed surface stop polling; it then ends as `starting`.
 */
export const wakeManagedDeviceAndWait = async (
  device: Pick<DeviceListItem, 'deviceId' | 'scope'>,
  deps: Pick<ReconnectDeviceDeps, 'refreshDevices' | 'sleep' | 'wakeManagedDevice'> & {
    shouldStop?: () => boolean;
  },
): Promise<Extract<ReconnectOutcome, 'connected' | 'starting'>> => {
  await deps.wakeManagedDevice({ deviceId: device.deviceId, scope: device.scope });
  const online = await pollDeviceOnline(device.deviceId, MANAGED_DEVICE_WAKE_POLL, {
    refreshDevices: deps.refreshDevices,
    shouldStop: deps.shouldStop,
    sleep: deps.sleep ?? defaultSleep,
  });
  return online ? 'connected' : 'starting';
};

/**
 * Bring a device back online from the device picker, then poll the device
 * list until it is online. The list refresh also refreshes a managed
 * device's phase.
 *
 * - A managed cloud device is woken through the server. It has no desktop app,
 *   so the desktop deep link cannot reach it.
 * - This desktop app's own device reconnects its gateway connection.
 * - Any other device gets the `lobehub://` deep link for its desktop app.
 *
 * A failed wake or reconnect request throws. A failed list refresh does not:
 * it counts as one poll in which the device is not online yet, so a passing
 * network error after an accepted wake still ends as `starting`, and the user
 * is not asked to send a second wake.
 */
export const reconnectDevice = async (
  device: Pick<DeviceListItem, 'deviceId' | 'identitySource' | 'scope'>,
  { isCurrentMachine }: { isCurrentMachine: boolean },
  deps: ReconnectDeviceDeps,
): Promise<ReconnectOutcome> => {
  const { deviceId } = device;
  if (isManagedCloudDevice(device)) return wakeManagedDeviceAndWait(device, deps);

  if (isCurrentMachine) {
    await deps.connectGateway();
  } else {
    deps.openDeepLink(`lobehub://device/reconnect?deviceId=${encodeURIComponent(deviceId)}`);
  }

  const online = await pollDeviceOnline(deviceId, DEVICE_RECONNECT_POLL, {
    refreshDevices: deps.refreshDevices,
    sleep: deps.sleep ?? defaultSleep,
  });
  return online ? 'connected' : 'failed';
};
