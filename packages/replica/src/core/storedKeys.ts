import { REPLICA_INDEX_KEY } from './engine';
import type { ReplicaResource } from './types';

/**
 * The entry storage keys this resource has a persisted row for in the active
 * scope, oldest first.
 *
 * Storage has no key listing of its own; the engine keeps one index row per
 * scope (`REPLICA_INDEX_KEY`) as it persists and drops entries, and this reads
 * it. That is how code outside the owning store reaches rows an *earlier
 * session* wrote — bounding how many survive a reload, or invalidating a row
 * whose entry is not loaded in memory.
 *
 * The keys are storage keys (`key`, plus `?query` when the resource sets one),
 * so a caller only matches them against entry keys when the resource leaves
 * `query` unset.
 */
export const readReplicaStoredKeys = async (
  resource: Pick<ReplicaResource<any, any, any>, 'scope' | 'storage'>,
): Promise<string[]> => {
  const row = await resource.storage?.get({
    queryKey: REPLICA_INDEX_KEY,
    scope: resource.scope.get(),
  });
  return (row?.data as unknown as string[] | undefined) ?? [];
};
