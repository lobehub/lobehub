import type { Fetcher, Key, SWRConfiguration, SWRResponse } from 'swr';
import useSWR, { useSWRConfig } from 'swr';
import type { ScopedMutator } from 'swr/_internal';

const scopedMutateRef: { current: ScopedMutator | null } = { current: null };

/**
 * Trash is loaded behind a deferred settings boundary, so its SWR bridge stays
 * local instead of pulling the eager application SWR/store graph into the
 * desktop entry. Callers include the workspace scope in every concrete key.
 */
export const useTrashDataSWR = <Data = unknown, Error = unknown>(
  key: Key,
  fetcher: Fetcher<Data> | null,
  config?: SWRConfiguration<Data, Error>,
): SWRResponse<Data, Error> => {
  const { mutate } = useSWRConfig();
  scopedMutateRef.current = mutate;

  return useSWR<Data, Error>(key, fetcher, {
    dedupingInterval: 0,
    focusThrottleInterval: 5 * 60 * 1000,
    refreshWhenOffline: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    ...config,
  });
};

/**
 * Use the mutator from the mounted SWRConfig provider. Predicate keys are
 * forwarded verbatim; concrete Trash keys already carry their scope token.
 */
export const mutateTrash: ScopedMutator = (async (...args: Parameters<ScopedMutator>) => {
  if (!scopedMutateRef.current) {
    console.warn('[trash] SWR mutate is not initialized');
    return [];
  }

  return scopedMutateRef.current(...args);
}) as ScopedMutator;
