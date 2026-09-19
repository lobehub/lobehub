/**
 * Process-local, TTL'd, size-bounded key/value cache.
 *
 * The Feishu bot helpers keep small pieces of per-chat / per-message state
 * (`chatComposition`, `reactionTracker`) in agent-runtime Redis, because
 * queue-mode callbacks land in a different process from the one that wrote
 * the state. Deployments without that Redis (local / single-process) still
 * need the state to survive between calls in the same process — otherwise
 * every inbound message costs a Feishu round-trip, or every reaction step
 * stacks instead of swapping. This is that fallback: bounded so an app
 * subscribed to many chats cannot grow it without limit, and expiring on the
 * same TTLs the Redis keys use.
 */
export interface BoundedMemoryCache<T> {
  clear: () => void;
  delete: (key: string) => void;
  get: (key: string) => T | undefined;
  set: (key: string, value: T, ttlSeconds: number) => void;
}

export const createBoundedMemoryCache = <T>(maxEntries: number): BoundedMemoryCache<T> => {
  const entries = new Map<string, { expiresAt: number; value: T }>();

  return {
    clear: () => entries.clear(),
    delete: (key) => {
      entries.delete(key);
    },
    get: (key) => {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set: (key, value, ttlSeconds) => {
      // Re-inserting moves the key to the end, so insertion order doubles as
      // "least recently written" and the first key is the eviction candidate.
      entries.delete(key);
      if (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value });
    },
  };
};
