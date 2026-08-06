import type {
  HeterogeneousProviderConfig,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';
import useSWR from 'swr';

import { heterogeneousAgentCatalogService } from '@/services/heterogeneousAgent';

const DEDUPING_INTERVAL = 5 * 60 * 1000;

const fingerprintConfig = (provider: HeterogeneousProviderConfig | undefined) => {
  const serialized = JSON.stringify({
    args: provider?.args ?? [],
    env: Object.entries(provider?.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  });
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

interface UseHeterogeneousAgentModelCatalogParams {
  cwd?: string;
  deviceId?: string;
  enabled: boolean;
  provider?: HeterogeneousProviderConfig;
  type: ListHeterogeneousAgentModelsParams['type'];
}

/**
 * Keep the catalog request active for the selector's entire mounted lifetime so
 * the models start loading with the conversation page rather than on menu open.
 */
export const useHeterogeneousAgentModelCatalog = ({
  cwd,
  deviceId,
  enabled,
  provider,
  type,
}: UseHeterogeneousAgentModelCatalogParams) =>
  useSWR(
    enabled
      ? [
          'heterogeneous-agent-model-catalog',
          type,
          deviceId ?? 'local',
          cwd ?? '',
          provider?.command ?? '',
          fingerprintConfig(provider),
        ]
      : null,
    async () => {
      const result = await heterogeneousAgentCatalogService.listModels({
        command: provider?.command,
        cwd,
        deviceId,
        env: provider?.env,
        type,
      });
      if (result.status === 'error') {
        const catalogError = new Error(result.error.message);
        catalogError.name = result.error.code;
        throw catalogError;
      }
      return result;
    },
    {
      dedupingInterval: DEDUPING_INTERVAL,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
