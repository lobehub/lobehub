import type { DeviceListeningPortsResult } from '@lobechat/types';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';

export interface DeviceTunnelLink {
  createdAt: number;
  deviceId: string;
  expiresAt?: number;
  hostname: string;
  port: number;
  slug: string;
  url: string;
}

/**
 * Tunnel links for one device: a port on that machine, reachable at
 * `https://<port>--<slug>.lobe.sh/`.
 *
 * Read-only and on demand — no polling. A link's lifetime is measured in days,
 * and the list only changes when this UI creates or revokes one, so the local
 * mutations below refresh it rather than a background interval.
 */
export const useFetchDeviceTunnels = (deviceId?: string, enabled = true) => {
  const workspaceId = useActiveWorkspaceId();

  return useClientDataSWR<DeviceTunnelLink[]>(
    enabled && deviceId ? deviceKeys.tunnels(workspaceId, deviceId) : null,
    async () => deviceService.listTunnels({ deviceId }),
    { revalidateOnFocus: false },
  );
};

/**
 * Ports the device is listening on, for one-click exposure. Asked when the
 * working panel shows (and on focus) rather than polled: detection spawns a
 * process on the device, and a port that appears later is one click of
 * "refresh" away. `null` data means the device couldn't answer.
 */
export const useFetchDeviceListeningPorts = (
  deviceId: string | undefined,
  cwd: string | undefined,
  enabled = true,
) => {
  const workspaceId = useActiveWorkspaceId();

  return useClientDataSWR<DeviceListeningPortsResult | null>(
    enabled && deviceId ? deviceKeys.listeningPorts(workspaceId, deviceId, cwd) : null,
    async () => deviceService.listListeningPorts({ cwd, deviceId: deviceId! }),
    { revalidateOnFocus: true },
  );
};
