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
