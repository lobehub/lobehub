import { useMemo } from 'react';

import {
  deviceListeningPortsKey,
  type DeviceListeningPortsParams,
  deviceTunnelsKey,
} from './tunnel/projection';
import { useDeviceTunnelStore } from './tunnel/store';

export type { DeviceTunnelLink } from './tunnel/projection';

/**
 * The driver forwards SWR options as given: a failed device read (offline,
 * unreachable gateway) is not retried, like the SWR hooks these replaced.
 */
const noRetry = { shouldRetryOnError: false };
export { getDeviceTunnelStoreState, useDeviceTunnelStore } from './tunnel/store';

/**
 * Tunnel links for one device: a port on that machine, reachable at
 * `https://<port>--<slug>.lobe.sh/`.
 *
 * A replica: a reload paints the links persisted last session, and the read
 * confirms them. Read on demand — no polling, no focus revalidation: a link's
 * lifetime is measured in days and the list only changes when this UI creates
 * or revokes one, which writes the result into the replica (`addTunnelLink` /
 * `removeTunnelLink`). The 10s dedupe collapses readers mounting together.
 */
export const useFetchDeviceTunnels = (deviceId?: string, enabled = true) => {
  const params = useMemo(() => (enabled && deviceId ? { deviceId } : null), [enabled, deviceId]);
  const key = params ? deviceTunnelsKey(params) : undefined;
  const data = useDeviceTunnelStore((s) => (key ? s.deviceTunnelsMap[key] : undefined));
  const { error, isHydrated, isValidating, revalidate } = useDeviceTunnelStore
    .getState()
    .slices.tunnels.useSync(params, {
      dedupingInterval: 10 * 1000,
      revalidateOnFocus: false,
      ...noRetry,
    });

  return {
    data,
    error,
    isLoading: !!params && data === undefined && !error && (!isHydrated || isValidating),
    isValidating,
    mutate: revalidate,
  };
};

/**
 * Ports the device is listening on, for one-click exposure. Asked when the
 * working panel shows (and on focus) rather than polled: detection spawns a
 * process on the device, and a port that appears later is one click of
 * "refresh" away.
 *
 * The persisted ports paint first, but whether they still listen is unknown
 * until the device answers this session: `isConfirmed` is false until then,
 * and the UI must not present a persisted port as running. A device that
 * cannot answer surfaces as `error`, and the persisted ports stay unconfirmed.
 */
export const useFetchDeviceListeningPorts = (
  deviceId: string | undefined,
  cwd: string | undefined,
  enabled = true,
) => {
  const params = useMemo<DeviceListeningPortsParams | null>(
    () => (enabled && deviceId ? { cwd, deviceId } : null),
    [enabled, deviceId, cwd],
  );
  const key = params ? deviceListeningPortsKey(params) : undefined;
  const data = useDeviceTunnelStore((s) => (key ? s.deviceListeningPortsMap[key] : undefined));
  const isConfirmed = useDeviceTunnelStore(
    (s) => !!key && s.deviceListeningPortsReplica.entries[key]?.source === 'server',
  );
  const { error, isHydrated, isValidating, revalidate } = useDeviceTunnelStore
    .getState()
    .slices.listeningPorts.useSync(params, {
      dedupingInterval: 10 * 1000,
      revalidateOnFocus: true,
      ...noRetry,
    });

  return {
    data,
    error,
    isConfirmed,
    isLoading: !!params && data === undefined && !error && (!isHydrated || isValidating),
    isValidating,
    mutate: revalidate,
  };
};
