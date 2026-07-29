/**
 * SWR cache repository backed by the runtime-neutral local database.
 */
import { localDatabase } from '@/libs/localDatabase';

interface CacheRow {
  data: unknown;
  updatedAt: number;
  version?: string;
}

export interface ScopeEntry extends CacheRow {
  key: string;
}

export interface LocalDataCachePutEntry extends CacheRow {
  /** Full composite key, including the identity scope prefix. */
  key: string;
}

export interface LocalDataCacheBatch {
  deleteKeys: string[];
  putEntries: LocalDataCachePutEntry[];
}

const CACHE_COLLECTION = 'swr-cache';

const scopePrefix = (scope: string) => `${scope}::`;

/** Build the composite persistence key from the identity scope and SWR key. */
export const buildLocalDataKey = (scope: string, swrKey: unknown): string =>
  `${scopePrefix(scope)}${typeof swrKey === 'string' ? swrKey : JSON.stringify(swrKey)}`;

export const localDataCache = {
  /**
   * Atomically replace persisted cache rows. Migration callers receive a
   * rejection when the transaction cannot commit so source rows remain
   * available for a later retry.
   */
  applyBatch: ({ deleteKeys, putEntries }: LocalDataCacheBatch): Promise<void> =>
    localDatabase.batch([
      ...putEntries.map(({ key, ...value }) => ({
        collection: CACHE_COLLECTION,
        key,
        type: 'set' as const,
        value,
      })),
      ...deleteKeys.map((key) => ({ collection: CACHE_COLLECTION, key, type: 'delete' as const })),
    ]),

  clearScope: async (scope: string): Promise<void> => {
    try {
      await localDatabase.deleteByPrefix(CACHE_COLLECTION, scopePrefix(scope));
    } catch {
      // Cache persistence is best-effort.
    }
  },

  delete: async (key: string): Promise<void> => {
    try {
      await localDatabase.delete(CACHE_COLLECTION, key);
    } catch {
      // Cache persistence is best-effort.
    }
  },

  entriesByScope: async (scope: string): Promise<ScopeEntry[]> => {
    try {
      const prefix = scopePrefix(scope);
      const entries = await localDatabase.entriesByPrefix<CacheRow>(CACHE_COLLECTION, prefix);
      return entries.map(({ key, value }) => ({
        ...value,
        key: key.slice(prefix.length),
      }));
    } catch {
      return [];
    }
  },

  get: async <T>(key: string): Promise<T | undefined> => {
    try {
      const row = await localDatabase.get<CacheRow>(CACHE_COLLECTION, key);
      return row?.data as T | undefined;
    } catch {
      return undefined;
    }
  },

  set: async (key: string, data: unknown, version?: string): Promise<void> => {
    try {
      await localDatabase.set(CACHE_COLLECTION, key, { data, updatedAt: Date.now(), version });
    } catch {
      // Cache persistence is best-effort.
    }
  },
};
