import type { ReplicaSyncResult } from '@/libs/replica';

/**
 * The `{ data, error, isLoading, mutate }` shape the eval pages read, backed by
 * a replica entry instead of a hand-keyed SWR cache. `data` is the store entry.
 */
export interface ReplicaQueryResult<T> extends ReplicaSyncResult {
  /** The entry once it has settled (hydrated or fetched), else `undefined`. */
  data: T | undefined;
  /** First load in flight with nothing settled yet; never true for a disabled hook. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
}

/** A failed first load is neither loading nor settled, so the page reaches its error state. */
export const toReplicaQueryResult = <T>(
  sync: ReplicaSyncResult,
  data: T | undefined,
  active: boolean,
): ReplicaQueryResult<T> => ({
  ...sync,
  data,
  isLoading: active && data === undefined && !sync.error,
  mutate: sync.revalidate,
});
