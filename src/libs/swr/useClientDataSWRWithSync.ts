/**
 * useClientDataSWR with automatic Zustand store sync
 *
 * Solves the problem of SWR cached data not being immediately synced to Zustand store.
 * When SWR returns data from the persisted cache, it will automatically sync to store via onData callback.
 *
 * Persistence (localStorage vs IndexedDB) is handled transparently by the
 * tier-aware SWR cache provider (see `localStorageProvider.ts`) based on the
 * SWR key — consumers never need to opt in per call.
 *
 * Why a `data`-keyed effect and not `onSuccess` alone: SWR only fires
 * `onSuccess` when a *network fetch* resolves, and with the *fetched* value — it
 * never fires for a cache hit (verified: a warm cache serves `response.data`
 * synchronously while `onSuccess` stays at 0 calls, and with
 * `revalidateIfStale: false` it never fires at all). So the cached snapshot can
 * only reach the store by reading `response.data`. We do that in one effect
 * deduped on the data reference: a key change yields a new data reference and
 * re-syncs automatically, so there is no second "reset on key change" effect to
 * order against — that two-effect ordering was the original skeleton-stuck bug.
 * An effect (not a render-phase write) keeps this safe under concurrent React,
 * where a render can be discarded before commit.
 */

import { useEffect, useRef } from 'react';
import { type SWRConfiguration, type SWRResponse } from 'swr';

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
  const { onData, skipSync, ...swrOptions } = options || {};

  const response = useClientDataSWR<T>(key, fetcher, swrOptions);

  const { data } = response;

  // Single source of delivery, keyed on the data reference. Covers both a cache
  // hit (data present on mount / after a key switch) and a fresh fetch (data
  // reference changes when SWR commits the new value). Dedupe on the reference
  // so a stable snapshot / re-render never re-fires, and StrictMode's double
  // effect invoke delivers exactly once.
  const syncedDataRef = useRef<T | undefined>(undefined);
  useEffect(() => {
    if (data === undefined || skipSync || !onData) return;
    if (syncedDataRef.current === data) return;
    syncedDataRef.current = data;
    onData(data);
  }, [data, skipSync, onData]);

  return response;
}
