import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';

/**
 * Live scan of the agent CLIs installed on a connected device, probed over the
 * device gateway. Pass no `deviceId` (e.g. while the device is offline) to skip
 * the probe.
 *
 * Shares its key with the device page and the connect wizard, so opening an
 * agent right after connecting it reuses that scan instead of starting another
 * ten-second probe. Only an explicit `mutate` re-probes.
 */
export const useDeviceAgentScan = (deviceId: string | undefined) =>
  useClientDataSWR(
    deviceId ? ['device/agentScan', deviceId] : null,
    () => (deviceId ? deviceService.scanAgents({ deviceId }) : null),
    { revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false },
  );
