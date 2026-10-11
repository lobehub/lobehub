/**
 * How many removal tombstones one engine remembers. The guards exist to win a
 * race with a hydrate that started around a removal, so a modest window is
 * plenty; the cap is what keeps a long-lived session from growing forever.
 */
export const DEFAULT_REMOVAL_TOMBSTONE_LIMIT = 5000;

export interface ReplicaTombstones {
  /** Remember `scope`/`key` (idempotent). */
  add: (scope: string, key: string) => void;
  /** Forget `scope`/`key`; an emptied scope bucket is dropped too. */
  clear: (scope: string, key: string) => void;
  has: (scope: string, key: string) => boolean;
  /** Keys tracked for `scope`, oldest first. */
  list: (scope: string) => string[];
  /** Tracked key count (observability + tests). */
  size: () => number;
}

/**
 * Scope-keyed removal tombstones with a hard size bound.
 *
 * A removal must stay visible until a server value supersedes it — including
 * across a scope switch, so the keys are bucketed per scope rather than in one
 * flat set. But the engine lives as long as the page: a session that visits tens
 * of thousands of subjects (a task list full of items that simply have no
 * acceptance) would otherwise pin one entry per subject forever. So the oldest
 * keys are evicted once the cap is reached.
 *
 * Eviction is safe for what the tombstone is for: it closes a race with a
 * hydrate that was already in flight when the removal landed. By the time a key
 * is old enough to be evicted, any such read has long since settled.
 */
export const createTombstones = (limit = DEFAULT_REMOVAL_TOMBSTONE_LIMIT): ReplicaTombstones => {
  const byScope = new Map<string, Set<string>>();
  let tracked = 0;

  const evictOverflow = () => {
    while (tracked > limit) {
      // `Map`/`Set` iterate in insertion order, so the first entry is the oldest.
      const oldestScope = byScope.keys().next().value as string;
      const keys = byScope.get(oldestScope)!;
      keys.delete(keys.values().next().value as string);
      tracked -= 1;
      if (keys.size === 0) byScope.delete(oldestScope);
    }
  };

  return {
    add: (scope, key) => {
      const keys = byScope.get(scope) ?? new Set<string>();
      byScope.set(scope, keys);
      if (keys.has(key)) return;
      keys.add(key);
      tracked += 1;
      evictOverflow();
    },
    clear: (scope, key) => {
      const keys = byScope.get(scope);
      if (!keys?.delete(key)) return;
      tracked -= 1;
      if (keys.size === 0) byScope.delete(scope);
    },
    has: (scope, key) => byScope.get(scope)?.has(key) ?? false,
    list: (scope) => [...(byScope.get(scope) ?? [])],
    size: () => tracked,
  };
};
