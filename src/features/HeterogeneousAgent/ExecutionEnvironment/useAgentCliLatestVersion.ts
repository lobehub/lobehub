import { useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';

/**
 * Newest release of an agent CLI. The server caches the registry read, so this
 * only keeps every device card from asking again within the hour. Pass no
 * `agentType` to skip the lookup.
 */
export const useAgentCliLatestVersion = (agentType: string | undefined) =>
  useClientDataSWR(
    agentType ? deviceKeys.agentCliLatestVersion(agentType) : null,
    async () =>
      agentType ? (await deviceService.getAgentCliLatestVersion(agentType)).latestVersion : null,
    {
      dedupingInterval: 60 * 60_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );
