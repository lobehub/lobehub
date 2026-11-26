interface DeviceArchitectureBackfillOptions {
  architecture: string;
  deviceId: string;
  headers: Record<string, string>;
  serverUrl: string;
  /** Signed-in user, so another account on this machine is checked again. */
  userId?: string;
}

/** How long a device the registry does not list yet waits before it is looked up again. */
export const UNLISTED_DEVICE_RETRY_MS = 10 * 60_000;

/**
 * Devices whose registry row already carries an architecture. The backfill runs
 * on every local device-info read (each window focus, each local run), and each
 * check downloads the whole device list, so a device is checked once per
 * process, not on every read, after the server confirms it.
 */
const settled = new Set<string>();
const unlistedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

/** Test hook: forget what earlier calls learned. */
export const resetDeviceArchitectureBackfill = () => {
  settled.clear();
  unlistedAt.clear();
  inFlight.clear();
};

const run = async (
  key: string,
  { architecture, deviceId, headers, serverUrl }: DeviceArchitectureBackfillOptions,
): Promise<void> => {
  const response = await fetch(`${serverUrl}/trpc/lambda/device.listDevices`, {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Device registry read failed: HTTP ${response.status}`);

  const payload = await response.json();
  const devices = payload?.result?.data?.json;
  if (!Array.isArray(devices)) return;

  const device = devices.find(
    (item) => item.deviceId === deviceId && item.scope === 'personal' && item.registered,
  );
  // Not registered yet: the gateway may register it later, so look again, but not on every read.
  if (!device) {
    unlistedAt.set(key, Date.now());
    return;
  }
  if (device.architecture) {
    settled.add(key);
    return;
  }

  const updated = await fetch(`${serverUrl}/trpc/lambda/device.updateDeviceInfo`, {
    body: JSON.stringify({
      json: { architecture, deviceId },
    }),
    headers,
    method: 'POST',
    signal: AbortSignal.timeout(5000),
  });
  if (!updated.ok) throw new Error(`Device architecture backfill failed: HTTP ${updated.status}`);
  settled.add(key);
};

export const backfillDeviceArchitecture = (
  options: DeviceArchitectureBackfillOptions,
): Promise<void> => {
  const key = [options.serverUrl, options.userId ?? '', options.deviceId].join('\n');
  if (settled.has(key)) return Promise.resolve();
  const unlisted = unlistedAt.get(key);
  if (unlisted !== undefined && Date.now() - unlisted < UNLISTED_DEVICE_RETRY_MS)
    return Promise.resolve();
  const running = inFlight.get(key);
  if (running) return running;

  const pending = run(key, options).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
};
