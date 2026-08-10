/**
 * useClientDataSWR with automatic Zustand store sync
 *
 * Solves the problem of SWR cached data not being immediately synced to Zustand store.
 * When SWR returns data from the persisted cache, it will automatically sync to store via onData callback.
 *
 * Persistence (localStorage vs IndexedDB) is handled transparently by the
 * tier-aware SWR cache provider (see `localStorageProvider.ts`) based on the
 * SWR key — consumers never need to opt in per call.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { type SWRConfiguration, type SWRResponse, unstable_serialize } from 'swr';

import { useClientDataSWR } from './index';

type Key = string | readonly unknown[] | null | undefined;

interface UseClientDataSWRWithSyncOptions<T> extends SWRConfiguration<T> {
  /**
   * Data sync callback, called when data is available (both cached and fresh data)
   * Used to sync data to Zustand store
   */
  onData?: (data: T) => void;
  /**
   * Whether to skip sync (optional, for conditional skipping)
   */
  skipSync?: boolean;
  /**
   * Synchronize cached data before browser paint.
   *
   * Use this when the Zustand projection controls the first-load surface and
   * a passive effect would otherwise paint a stale loading state for one frame.
   */
  syncBeforePaint?: boolean;
}

/**
 * Enhanced version of useClientDataSWR with automatic cache data sync to Zustand store
 *
 * Always build the key from its `*Keys` factory in `./keys`, never as a literal
 * tuple — an imperative `mutate` that hand-writes the same shape drifts silently
 * and warms an entry no subscriber ever reads.
 *
 * @example
 * ```ts
 * useClientDataSWRWithSync(
 *   isLogin ? agentKeys.list(isLogin) : null,
 *   () => homeService.getSidebarAgentList(),
 *   {
 *     onData: (data) => {
 *       // Auto sync to store, whether cached or fresh data
 *       set({ ...mapResponseToState(data), isInit: true });
 *     },
 *     skipSync: state.isInit, // Optional: skip after initialized
 *   }
 * );
 * ```
 */
export function useClientDataSWRWithSync<T>(
  key: Key,
  fetcher: (() => Promise<T>) | null,
  options?: UseClientDataSWRWithSyncOptions<T>,
): SWRResponse<T> {
  const { onData, skipSync, syncBeforePaint, onSuccess, ...swrOptions } = options || {};
  const serializedKey = unstable_serialize(key);
  const lastSyncedRef = useRef<{ data: T; key: string } | undefined>(undefined);

  const syncData = useCallback(
    (data: T) => {
      if (!serializedKey || !onData || skipSync) return;

      const lastSynced = lastSyncedRef.current;
      if (lastSynced?.key === serializedKey && Object.is(lastSynced.data, data)) return;

      onData(data);
      lastSyncedRef.current = { data, key: serializedKey };
    },
    [onData, serializedKey, skipSync],
  );

  const response = useClientDataSWR<T>(key, fetcher, {
    ...swrOptions,
    onSuccess: (data, key, config) => {
      // Call original onSuccess
      onSuccess?.(data, key, config);
      // Also sync via onData
      syncData(data);
    },
  });

  const { data } = response;

  // Loading projections that own the first-paint state consume hydrated cache
  // data in the layout phase so a cache hit never paints as a loading frame.
  useLayoutEffect(() => {
    if (!syncBeforePaint || data === undefined) return;

    syncData(data);
  }, [data, syncBeforePaint, syncData]);

  // Other projections retain passive synchronization to keep non-critical
  // cached-data processing off the initial render path.
  useEffect(() => {
    if (syncBeforePaint || data === undefined) return;

    syncData(data);
  }, [data, syncBeforePaint, syncData]);

  return response;
}
