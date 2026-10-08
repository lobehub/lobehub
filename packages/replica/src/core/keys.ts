/**
 * Keys of the queries a fetch adapter runs for a replica. Hosts that sweep
 * their query cache by prefix (e.g. "refetch everything after a restore")
 * match on {@link REPLICA_KEY_PREFIX}.
 */
export const REPLICA_KEY_PREFIX = 'replica:';

export const replicaKeys = {
  /** One-shot read of the persisted row for `storageKey`. */
  hydrate: (name: string, version: number, scope: string, storageKey: string) =>
    ['replica:hydrate', name, version, scope, storageKey] as const,
  /** Network sync of the head of one entry. */
  sync: (name: string, version: number, scope: string, key: string, params: unknown) =>
    ['replica:sync', name, version, scope, key, params] as const,
};

/** Match a resource's sync keys, optionally narrowed to one scope and/or entry key. */
export const isReplicaSyncKey = (
  queryKey: unknown,
  name: string,
  filter: { key?: string; scope?: string } = {},
): boolean =>
  Array.isArray(queryKey) &&
  queryKey[0] === 'replica:sync' &&
  queryKey[1] === name &&
  (filter.scope === undefined || queryKey[3] === filter.scope) &&
  (filter.key === undefined || queryKey[4] === filter.key);
