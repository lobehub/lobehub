/**
 * IndexedDB local-first data cache
 *
 * A scope-partitioned key/value store used as the IndexedDB *tier* of the
 * unified SWR cache provider (see `localStorageProvider.ts`). It backs large,
 * important business entities (messages, topics, tasks, documents, agents)
 * whose history blows past the ~5MB localStorage origin quota.
 *
 * Why IndexedDB rather than the localStorage SWR provider for these:
 * - localStorage has a ~5MB per-origin quota; large entity data exceeds it and
 *   a quota error there wipes the *entire* SWR cache. IndexedDB offers
 *   hundreds of MB and stores each entry as an independent row.
 *
 * The provider reads from this tier at boot (async) and writes through on every
 * cache update — consumers never touch it directly.
 *
 * Every key is partitioned by identity scope (`${userId}:${workspaceId}`) so
 * different users / workspaces sharing a browser origin never collide.
 */
import type { Table } from 'dexie';

interface CacheRow {
  data: unknown;
  /** Composite key: `${scope}::${serializedSWRKey}` */
  key: string;
  updatedAt: number;
  /** App cache version; mismatching rows are ignored on load. */
  version?: string;
}

export interface ScopeEntry {
  data: unknown;
  /** The SWR key (scope prefix stripped). */
  key: string;
  updatedAt: number;
  version?: string;
}

const DB_NAME = 'lobehub-local-data';
const STORE_NAME = 'cache';

const isAvailable = () => typeof indexedDB !== 'undefined';

// Lazily-created singleton Dexie instance. Kept out of module scope so SSR
// imports never touch IndexedDB.
let dbPromise: Promise<Table<CacheRow, string>> | null = null;

const getTable = async () => {
  if (!isAvailable()) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const { default: Dexie } = await import('dexie');
      const db = new Dexie(DB_NAME);
      db.version(1).stores({ [STORE_NAME]: 'key, updatedAt' });
      return db.table<CacheRow, string>(STORE_NAME);
    })();
  }
  return dbPromise;
};

const scopePrefix = (scope: string) => `${scope}::`;

/**
 * Build the composite IndexedDB key from the identity scope and the SWR key.
 */
export const buildLocalDataKey = (scope: string, swrKey: unknown): string =>
  `${scopePrefix(scope)}${typeof swrKey === 'string' ? swrKey : JSON.stringify(swrKey)}`;

export const localDataCache = {
  /**
   * Remove every entry belonging to a scope. Useful on logout / account switch.
   */
  clearScope: async (scope: string): Promise<void> => {
    try {
      const table = await getTable();
      if (!table) return;
      await table.where('key').startsWith(scopePrefix(scope)).delete();
    } catch {
      // best-effort; ignore
    }
  },

  delete: async (key: string): Promise<void> => {
    try {
      const table = await getTable();
      if (!table) return;
      await table.delete(key);
    } catch {
      // best-effort; ignore
    }
  },

  /**
   * Return every entry belonging to a scope, with the scope prefix stripped
   * back to the original SWR key. Used to hydrate the in-memory SWR cache.
   */
  entriesByScope: async (scope: string): Promise<ScopeEntry[]> => {
    try {
      const table = await getTable();
      if (!table) return [];
      const prefix = scopePrefix(scope);
      const rows = await table.where('key').startsWith(prefix).toArray();
      return rows.map((row) => ({
        data: row.data,
        key: row.key.slice(prefix.length),
        updatedAt: row.updatedAt,
        version: row.version,
      }));
    } catch {
      return [];
    }
  },

  get: async <T>(key: string): Promise<T | undefined> => {
    try {
      const table = await getTable();
      if (!table) return undefined;
      const row = await table.get(key);
      return row?.data as T | undefined;
    } catch {
      return undefined;
    }
  },

  set: async (key: string, data: unknown, version?: string): Promise<void> => {
    try {
      const table = await getTable();
      if (!table) return;
      await table.put({ data, key, updatedAt: Date.now(), version });
    } catch {
      // best-effort; ignore
    }
  },
};
