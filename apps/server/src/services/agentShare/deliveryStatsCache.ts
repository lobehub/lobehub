import type { SharedAgentDeliveryStats } from '@lobechat/types';

/** Aggregate snapshots may lag by one minute; access checks and curated Works are never cached. */
const TTL_MS = 60_000;
const MAX_ENTRIES = 256;

export const createDeliveryStatsCache = () => {
  const databases = new WeakMap<
    object,
    Map<string, { expiresAt: number; promise: Promise<SharedAgentDeliveryStats> }>
  >();

  return (
    db: object,
    ownerId: string,
    agentId: string,
    load: () => Promise<SharedAgentDeliveryStats>,
  ): Promise<SharedAgentDeliveryStats> => {
    let entries = databases.get(db);
    if (!entries) {
      entries = new Map();
      databases.set(db, entries);
    }
    const key = JSON.stringify([ownerId, agentId]);
    const existing = entries.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.promise;
    entries.delete(key);
    if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);

    /** Cache the in-flight promise too, so concurrent visitors share the same aggregate query. */
    const promise = Promise.resolve().then(load);
    entries.set(key, { expiresAt: Date.now() + TTL_MS, promise });
    void promise.catch(() => {
      if (entries.get(key)?.promise === promise) entries.delete(key);
    });
    return promise;
  };
};

export const getCachedDeliveryStats = createDeliveryStatsCache();
