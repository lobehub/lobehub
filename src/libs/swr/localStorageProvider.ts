/**
 * Unified tiered SWR cache provider
 *
 * One in-memory Map backs SWR (the cache contract stays synchronous). Behind
 * it, writes are transparently routed to a persistence *tier* chosen centrally
 * by the SWR key — consumers never opt in per call:
 *
 * - `idb`   → IndexedDB (see `localDataCache.ts`): large / important business
 *             entities (messages, topics, tasks, documents, agents). Loaded
 *             asynchronously at boot, stored as independent rows — no 5MB cap.
 * - `local` → localStorage: small, frequently-changing list shells (recents).
 *             Loaded synchronously for instant first paint.
 * - none    → memory only.
 *
 * Everything is partitioned by identity scope (`${userId}:${workspaceId}`) so
 * users / workspaces sharing a browser origin never collide; `reloadScope()`
 * re-hydrates in place when the scope changes (e.g. once auth resolves).
 *
 * @example
 * ```tsx
 * <SWRConfig value={{ provider: swrCacheProvider(getCacheScope) }}>
 *   <App />
 * </SWRConfig>
 * ```
 */
import { bootTiming } from '@/libs/bootTiming';

import { buildLocalDataKey, localDataCache } from './localDataCache';
import { isAnonymousScope } from './useCacheScope';

interface CacheEntry<T = unknown> {
  /** Cached data */
  data: T;
  /** Cache timestamp */
  timestamp: number;
  /** App version */
  version: string;
}

export type CacheTier = 'idb' | 'local';

export interface CacheProviderOptions {
  /** Debounce (ms) before flushing writes to either tier, defaults to 2000. */
  debounceMs?: number;
  /** Resolver for the active identity scope (`${userId}:${workspaceId}`). */
  getScope?: () => string;
  /** SWR key patterns persisted to the IndexedDB tier. */
  idbPatterns?: string[];
  /**
   * Predicate marking a scope as *provisional* — writes made while it is active
   * must never be persisted. On desktop the identity round-trip can complete (or
   * the CacheHydrationGate timeout backstop can fire) before `userId` resolves,
   * briefly making the scope anonymous. Data fetched + flushed during that
   * window lands in the `anon` partition and is orphaned the instant the real
   * user scope resolves (`reloadScope`), surfacing as a stale-loading cache miss
   * on the next boot. Keeping the in-memory cache but skipping persistence for
   * these scopes closes that leak.
   */
  isEphemeralScope?: (scope: string) => boolean;
  /** SWR key patterns persisted to the localStorage tier. */
  localPatterns?: string[];
  /** Max localStorage-tier entries, defaults to 50. */
  maxLocalEntries?: number;
  /** Error callback */
  onError?: (error: Error) => void;
  /** Called after a scope's IndexedDB tier finishes hydrating. */
  onScopeHydrated?: (scope: string) => void;
  /**
   * Cache TTL in milliseconds, defaults to 7 days. Governs the localStorage
   * tier only (small, frequently-changing shells like recents) — the IndexedDB
   * tier never expires (stale-while-revalidate).
   */
  ttl?: number;
  /** App version; entries from another version are ignored on load. */
  version?: string;
}

/**
 * SWR cache provider function with an in-place scope reloader.
 */
export type ScopedSWRProvider = (() => Map<string, unknown>) & {
  /**
   * Ensure the provider's Map exists and hydrate the current scope's IndexedDB
   * tier. This is used by the SPA bootstrap while React mounts the root tree.
   */
  hydrateScope?: () => Promise<void>;
  /**
   * Flush pending writes, then re-hydrate the in-memory cache from the *current*
   * scope's namespaces (localStorage synchronously, IndexedDB asynchronously).
   * No-op until SWR has created the provider's Map.
   */
  reloadScope?: () => Promise<void>;
};

const isLocalStorageAvailable = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const testKey = '__swr_cache_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
};

/**
 * Check whether a (string) SWR key contains any of the patterns. SWR keys are
 * either a plain string or a serialized array like `'["fetchSessions","u1"]'`.
 */
const matchesPattern = (key: string, patterns: string[]): boolean =>
  patterns.some((pattern) => key.includes(pattern));

/**
 * Build the scoped localStorage cache key (localStorage tier namespace).
 *
 * Partitioned per identity scope so different users / workspaces sharing the
 * same browser origin never read or overwrite each other's cached data.
 */
export const getScopedCacheKey = (scope: string) => `lobechat-swr-cache:${scope}`;

/**
 * Create a unified tiered cache provider.
 */
export function createCacheProvider(options: CacheProviderOptions = {}): ScopedSWRProvider {
  const {
    debounceMs = 2000,
    getScope = () => 'default',
    idbPatterns = [],
    isEphemeralScope,
    localPatterns = [],
    ttl = 7 * 24 * 60 * 60 * 1000, // 7 days
    maxLocalEntries = 50,
    version = '1.0.0',
    onError = (error) => console.error('[SWR Cache]', error),
    onScopeHydrated,
  } = options;

  // SSR / no storage → plain memory cache, no persistence. Still signal
  // hydration so boot initialization never blocks.
  if (!isLocalStorageAvailable()) {
    const memoryProvider = (() => {
      onScopeHydrated?.(getScope());
      return new Map();
    }) as ScopedSWRProvider;
    memoryProvider.hydrateScope = async () => {
      onScopeHydrated?.(getScope());
    };
    memoryProvider.reloadScope = memoryProvider.hydrateScope;

    return memoryProvider;
  }

  /** Route a key to its persistence tier (idb wins over local). */
  const tierOf = (key: string): CacheTier | null => {
    if (matchesPattern(key, idbPatterns)) return 'idb';
    if (matchesPattern(key, localPatterns)) return 'local';
    return null;
  };

  /**
   * Whether the *current* scope may be written to persistence. Provisional
   * scopes (see `isEphemeralScope`) stay memory-only so their transient boot
   * data never leaks into a partition that gets orphaned on the next scope flip.
   */
  const isPersistableScope = (): boolean => !isEphemeralScope?.(getScope());

  let cacheMapInstance: TieredCacheMap | null = null;
  let hydratedScope: string | null = null;
  let hydrationEpoch = 0;
  let pendingHydration: { promise: Promise<void>; scope: string } | null = null;
  let cacheHydrationSpanRecorded = false;

  // --- localStorage tier (synchronous snapshot) ----------------------------
  let localTimer: ReturnType<typeof setTimeout> | null = null;

  const loadLocal = (): Map<string, unknown> => {
    try {
      const stored = localStorage.getItem(getScopedCacheKey(getScope()));
      if (!stored) return new Map();
      const entries: [string, CacheEntry][] = JSON.parse(stored);
      const now = Date.now();
      return new Map(
        entries
          .filter(([, e]) => now - e.timestamp <= ttl && e.version === version)
          .map(([key, e]) => [key, e.data] as [string, unknown]),
      );
    } catch (error) {
      onError(error as Error);
      return new Map();
    }
  };

  const saveLocal = () => {
    if (!cacheMapInstance) return;
    if (!isPersistableScope()) return;
    const key = getScopedCacheKey(getScope());
    try {
      const entries = Array.from(cacheMapInstance.entries())
        .filter(([k]) => matchesPattern(k, localPatterns))
        .slice(-maxLocalEntries)
        .map(([k, data]) => [k, { data, timestamp: Date.now(), version } as CacheEntry]);

      const serialized = JSON.stringify(entries);
      const sizeInMB = new Blob([serialized]).size / (1024 * 1024);
      if (sizeInMB > 4) {
        // Drop oldest half rather than wiping everything.
        localStorage.setItem(key, JSON.stringify(entries.slice(-Math.floor(maxLocalEntries / 2))));
        console.warn(`[SWR Cache] localStorage tier too large (${sizeInMB.toFixed(2)}MB), trimmed`);
      } else {
        localStorage.setItem(key, serialized);
      }
    } catch (error) {
      if ((error as DOMException).name === 'QuotaExceededError') {
        try {
          localStorage.removeItem(key);
        } catch {
          // ignore
        }
        console.error('[SWR Cache] Quota exceeded, localStorage tier cleared');
      } else {
        onError(error as Error);
      }
    }
  };

  const debouncedSaveLocal = () => {
    if (localTimer) clearTimeout(localTimer);
    localTimer = setTimeout(saveLocal, debounceMs);
  };

  // --- IndexedDB tier (asynchronous, per-key rows) -------------------------
  let idbTimer: ReturnType<typeof setTimeout> | null = null;
  const dirtyIdb = new Set<string>();
  const deletedIdb = new Set<string>();

  const flushIdb = () => {
    if (!cacheMapInstance) return;
    const scope = getScope();
    if (isEphemeralScope?.(scope)) return;
    const writes = [...dirtyIdb];
    const dels = [...deletedIdb];
    dirtyIdb.clear();
    deletedIdb.clear();

    for (const k of dels) void localDataCache.delete(buildLocalDataKey(scope, k));
    for (const k of writes) {
      const v = cacheMapInstance.get(k);
      if (v !== undefined) void localDataCache.set(buildLocalDataKey(scope, k), v, version);
    }
  };

  const debouncedFlushIdb = () => {
    if (idbTimer) clearTimeout(idbTimer);
    idbTimer = setTimeout(flushIdb, debounceMs);
  };

  const loadIdb = async (scope: string, epoch: number, hydrationStart?: number) => {
    let succeeded = false;
    try {
      const entries = await localDataCache.entriesByScope(scope);
      // The IndexedDB tier holds read-heavy / write-light business entities
      // (messages, topics, …): once written, a row rarely changes. We never drop
      // these by age — a stale row hydrates for an instant first paint and SWR's
      // revalidate-on-mount refreshes it in the background (stale-while-revalidate).
      // Version is the only invalidator: a row must carry the *current* version,
      // so legacy/unversioned rows (which the age check used to bound) are dropped
      // and a version bump still evicts everyone. TTL governs the localStorage
      // tier only (see `loadLocal`).
      const valid = entries.filter((e) => e.version === version);
      // Map may have changed scope while we awaited; only apply if still current.
      if (cacheMapInstance && getScope() === scope && hydrationEpoch === epoch) {
        cacheMapInstance.hydrate(valid.map((e) => [e.key, e.data]));
        hydratedScope = scope;
      }
      succeeded = true;
    } catch (error) {
      onError(error as Error);
    } finally {
      if (hydrationStart !== undefined && succeeded && !cacheHydrationSpanRecorded) {
        cacheHydrationSpanRecorded = true;
        bootTiming.recordSpan(
          'cache-hydration',
          hydrationStart,
          performance.now() - hydrationStart,
        );
      }
      onScopeHydrated?.(scope);
      if (pendingHydration?.scope === scope && hydrationEpoch === epoch) {
        pendingHydration = null;
      }
    }
  };

  // --- write routing -------------------------------------------------------
  const onSet = (key: string) => {
    // Provisional scope → memory only; never schedule a persist (see
    // `isEphemeralScope`). The post-flip global revalidation re-writes keys
    // under the resolved scope, so nothing is lost.
    if (!isPersistableScope()) return;
    const tier = tierOf(key);
    if (tier === 'local') debouncedSaveLocal();
    else if (tier === 'idb') {
      deletedIdb.delete(key);
      dirtyIdb.add(key);
      debouncedFlushIdb();
    }
  };

  const onDelete = (key: string) => {
    if (!isPersistableScope()) return;
    const tier = tierOf(key);
    if (tier === 'local') debouncedSaveLocal();
    else if (tier === 'idb') {
      dirtyIdb.delete(key);
      deletedIdb.add(key);
      debouncedFlushIdb();
    }
  };

  /**
   * Map that routes writes to the correct persistence tier. `hydrate` /
   * `dropPersisted` mutate the map without triggering persistence.
   */
  class TieredCacheMap extends Map<string, unknown> {
    private live = false;

    set(key: string, value: unknown): this {
      super.set(key, value);
      if (this.live) onSet(key);
      return this;
    }

    delete(key: string): boolean {
      const result = super.delete(key);
      if (this.live) onDelete(key);
      return result;
    }

    /** Bulk-load entries without persisting them back. */
    hydrate(entries: readonly (readonly [string, unknown])[]): void {
      for (const [key, value] of entries) super.set(key, value);
      this.live = true;
    }

    /** Remove all persisted-tier entries from memory without persisting deletes. */
    dropPersisted(): void {
      // Snapshot keys first — we mutate the map while iterating.
      const keys = Array.from(this.keys());
      for (const key of keys) if (tierOf(key)) super.delete(key);
    }
  }

  // Flush both tiers as early as possible. IndexedDB writes are async and can't
  // be awaited during teardown, so we must not wait for `beforeunload`: by then
  // the browser is free to kill the page before `flushIdb()`'s writes land.
  // Instead flush the moment the page is *hidden* (tab switch / minimize / app
  // background) — the page is still alive there, so the async writes have time
  // to complete well before any actual unload. `pagehide` is a best-effort
  // backstop for the desktop close case (and is bfcache-friendly, unlike
  // `beforeunload`).
  const flushAll = () => {
    if (localTimer) {
      clearTimeout(localTimer);
      localTimer = null;
    }
    if (idbTimer) {
      clearTimeout(idbTimer);
      idbTimer = null;
    }
    saveLocal();
    flushIdb();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  window.addEventListener('pagehide', flushAll);

  // Multi-tab sync for the localStorage tier only.
  window.addEventListener('storage', (event) => {
    if (event.key === getScopedCacheKey(getScope()) && event.newValue && cacheMapInstance) {
      try {
        const parsed: [string, CacheEntry][] = JSON.parse(event.newValue);
        parsed.forEach(([key, entry]) => {
          if (matchesPattern(key, localPatterns)) cacheMapInstance!.hydrate([[key, entry.data]]);
        });
      } catch (error) {
        onError(error as Error);
      }
    }
  });

  const ensureMap = (): TieredCacheMap => {
    if (cacheMapInstance) return cacheMapInstance;

    const map = new TieredCacheMap();
    cacheMapInstance = map;
    map.hydrate([...loadLocal().entries()]); // synchronous first paint
    return map;
  };

  const hydrateScope = async (): Promise<void> => {
    const scope = getScope();
    ensureMap();
    if (hydratedScope === scope) return;
    if (pendingHydration?.scope === scope) return pendingHydration.promise;

    const epoch = ++hydrationEpoch;
    const start = !cacheHydrationSpanRecorded ? performance.now() : undefined;
    const promise = loadIdb(scope, epoch, start);
    pendingHydration = { promise, scope };
    return promise;
  };

  const provider: ScopedSWRProvider = () => {
    const map = ensureMap();
    void hydrateScope();
    return map;
  };

  provider.hydrateScope = hydrateScope;

  provider.reloadScope = async () => {
    if (!cacheMapInstance) {
      await hydrateScope();
      return;
    }

    hydrationEpoch += 1;
    hydratedScope = null;
    pendingHydration = null;

    // Drop pending writes scheduled for the previous scope.
    if (localTimer) {
      clearTimeout(localTimer);
      localTimer = null;
    }
    if (idbTimer) {
      clearTimeout(idbTimer);
      idbTimer = null;
    }
    dirtyIdb.clear();
    deletedIdb.clear();

    cacheMapInstance.dropPersisted();
    cacheMapInstance.hydrate([...loadLocal().entries()]);
    await hydrateScope();
  };

  return provider;
}

/**
 * Clear the localStorage cache tier for a scope (or the legacy key).
 */
export function clearSWRCache(cacheKey = 'lobechat-swr-cache'): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(cacheKey);
    console.info('[SWR Cache] Cache cleared');
  } catch (error) {
    console.error('[SWR Cache] Failed to clear cache:', error);
  }
}

/**
 * Central tiering config — the single place that decides where each kind of
 * data is persisted, keyed by the `domain:` namespace of the SWR key (see the
 * key registry in `@/libs/swr/keys`). Matching is substring-based; the colon in
 * `domain:` keeps these from matching unrelated keys.
 */
export const CACHE_TIERS = {
  /** Large / important business entities → IndexedDB. */
  idb: [
    'message:', // chat messages (conversation + legacy stores)
    'topic:', // topic lists / agent view / search
    'agent:', // sidebar agent list + agent documents
    'group:detail', // group detail (group list stays in localStorage)
    'task:', // task lists + detail
    'document:', // editor document content
    'page:', // page detail / list / meta
    'notebook:', // notebook documents
    'brief:', // briefs
  ],
  /** Small, frequently-changing list shells → localStorage (sync first paint). */
  local: [
    'recent:list',
    'fetchRecentTopics',
    'fetchRecentResources',
    'fetchRecentPages',
    'group:list',
    'taskTemplate:', // home task-template recommendations
    'modelConfig:', // small remote model config shells used by home starter chips
  ],
} as const;

/**
 * Provider factory for SWRConfig.
 *
 * @param getScope resolver for the current identity scope. Evaluated lazily so
 *   persistence follows the active user/workspace; call `provider.reloadScope()`
 *   after the scope changes to re-hydrate in place.
 * @param onScopeHydrated notified after a scope's IndexedDB tier finishes loading.
 */
export const swrCacheProvider = (
  getScope: () => string,
  onScopeHydrated?: (scope: string) => void,
): ScopedSWRProvider => {
  return createCacheProvider({
    getScope,
    idbPatterns: [...CACHE_TIERS.idb],
    // Desktop's anonymous scope is a transient pre-identity boot state (a
    // successful `getUserState` always resolves a real `userId`), so quarantine
    // its writes from persistence — otherwise a slow identity round-trip lets
    // real data land in the `anon` partition and get orphaned on the scope flip.
    // The anonymous scope is only ever a transient pre-identity boot state —
    // quarantine its writes from persistence so a slow identity round-trip
    // can't land real data in the `anon` partition and orphan it on the scope
    // flip. (The CacheHydrationGate now blocks paint until `userId` resolves, so
    // this is defense-in-depth for any fetcher that mounts outside the gate.)
    isEphemeralScope: isAnonymousScope,
    localPatterns: [...CACHE_TIERS.local],
    onScopeHydrated,
    // Governs the localStorage tier only (recents-style shells); the IndexedDB
    // tier (messages, topics, …) never expires. 7 days is plenty for recents.
    ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};
