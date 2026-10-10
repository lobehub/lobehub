import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';

/**
 * Reads the selected connector's live capability contract.
 *
 * Use when: gating device-only controls before a server-validated dispatch.
 * Expects: an optional authorized device id in the active workspace.
 * Returns: absent data while unknown/offline; callers must fail closed.
 */
export const useDeviceCapabilities = (deviceId?: string) => {
  const workspaceId = useActiveWorkspaceId();
  return useClientDataSWR(
    deviceId ? deviceKeys.systemInfo(workspaceId, deviceId) : null,
    () => deviceService.getSystemInfo(deviceId!),
    { refreshInterval: 30_000, shouldRetryOnError: false },
  );
};
