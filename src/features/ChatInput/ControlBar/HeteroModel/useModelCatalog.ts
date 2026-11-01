import type {
  HeterogeneousAgentModelCatalogSuccess,
  HeterogeneousProviderConfig,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';
import { useEffect, useMemo, useRef } from 'react';

import {
  fingerprintConfig,
  heteroModelCatalogKey,
  type HeteroModelCatalogParams,
} from '@/store/device/heteroModelCatalog/projection';
import { useHeteroModelCatalogStore } from '@/store/device/heteroModelCatalog/store';

/**
 * Discovery spawns the CLI: a focus change does not re-run it, and a failure
 * (missing CLI, unreachable device) is not retried. The driver forwards
 * `shouldRetryOnError` to SWR as given.
 */
const SYNC_OPTIONS = {
  dedupingInterval: 5 * 60 * 1000,
  revalidateOnFocus: false,
  shouldRetryOnError: false,
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

export interface ModelCatalogResult {
  data: HeterogeneousAgentModelCatalogSuccess | undefined;
  /** A failed discovery; `name` is the catalog error code. */
  error: Error | undefined;
  /** Nothing to paint yet (no persisted catalog, no response) and a read is pending. */
  isLoading: boolean;
  isValidating: boolean;
  mutate: () => Promise<unknown>;
}

/**
 * The catalog is a replica (`@/store/device/heteroModelCatalog`): the last
 * catalog of this device + agent paints on the first frame, and the CLI
 * discovery confirms it in the background.
 *
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
}: UseHeterogeneousAgentModelCatalogParams): ModelCatalogResult => {
  const wasOpenRef = useRef(open);
  const enabled = targetReady && !isDeviceListLoading && !isPreferenceLoading;
  // Only the discovery inputs: a model / effort pick must not start another
  // discovery. `fingerprint` stands in for args + env in the memo deps.
  const fingerprint = fingerprintConfig(provider);
  const params = useMemo<HeteroModelCatalogParams | null>(
    () =>
      enabled
        ? {
            cwd,
            deviceId,
            provider: provider && {
              args: provider.args,
              command: provider.command,
              env: provider.env,
              type: provider.type,
            },
            type,
          }
        : null,
    [enabled, cwd, deviceId, provider?.command, provider?.type, fingerprint, type],
  );
  const key = params ? heteroModelCatalogKey(params) : undefined;
  const data = useHeteroModelCatalogStore((s) => (key ? s.heteroModelCatalogMap[key] : undefined));
  const { error, isHydrated, isValidating, revalidate } = useHeteroModelCatalogStore
    .getState()
    .slice.useSync(params, SYNC_OPTIONS);
  const catalogError = error as Error | undefined;

  useEffect(() => {
    const hasJustOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;

    if (hasJustOpened && catalogError) void revalidate();
  }, [open, catalogError, revalidate]);

  return {
    data,
    error: catalogError,
    isLoading: !!params && data === undefined && !catalogError && (!isHydrated || isValidating),
    isValidating,
    mutate: revalidate,
  };
};
