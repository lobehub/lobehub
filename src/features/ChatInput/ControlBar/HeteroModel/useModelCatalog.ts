import type {
  HeterogeneousProviderConfig,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';
import { useEffect, useRef } from 'react';
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
  isDeviceListLoading: boolean;
  isPreferenceLoading: boolean;
  open: boolean;
  provider?: HeterogeneousProviderConfig;
  targetReady: boolean;
  type: ListHeterogeneousAgentModelsParams['type'];
}

/**
 * Preload after the member's effective target and device directory settle, then
 * revalidate a failed preload if the user opens the selector after the target
 * becomes available.
 */
export const useModelCatalog = ({
  cwd,
  deviceId,
  isDeviceListLoading,
  isPreferenceLoading,
  open,
  provider,
  targetReady,
  type,
}: UseHeterogeneousAgentModelCatalogParams) => {
  const wasOpenRef = useRef(open);
  const response = useSWR(
    targetReady && !isDeviceListLoading && !isPreferenceLoading
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

  useEffect(() => {
    const hasJustOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;

    if (hasJustOpened && response.error) void response.mutate();
  }, [open, response.error, response.mutate]);

  return response;
};
