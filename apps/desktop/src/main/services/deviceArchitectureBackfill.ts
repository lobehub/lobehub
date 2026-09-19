interface DeviceArchitectureBackfillOptions {
  architecture: string;
  deviceId: string;
  headers: Record<string, string>;
  serverUrl: string;
}

export const backfillDeviceArchitecture = async ({
  architecture,
  deviceId,
  headers,
  serverUrl,
}: DeviceArchitectureBackfillOptions): Promise<void> => {
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
  if (device?.architecture || !device?.identitySource) return;

  // Reuse registration's upsert without replacing metadata or user-owned settings.
  const updated = await fetch(`${serverUrl}/trpc/lambda/device.register`, {
    body: JSON.stringify({
      json: { architecture, deviceId, identitySource: device.identitySource },
    }),
    headers,
    method: 'POST',
    signal: AbortSignal.timeout(5000),
  });
  if (!updated.ok) throw new Error(`Device architecture backfill failed: HTTP ${updated.status}`);
};
