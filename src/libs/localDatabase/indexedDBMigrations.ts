export const INDEXED_DB_NAME = 'lobehub-local-data';
export const INDEXED_DB_RECORD_STORE = 'records';

interface IndexedDBMigrationContext {
  database: IDBDatabase;
  transaction: IDBTransaction;
}

interface IndexedDBMigration {
  migrate: (context: IndexedDBMigrationContext) => void;
  name: string;
  version: number;
}

/**
 * Dexie version 1 maps to IndexedDB version 10. Version 11 establishes the
 * runtime-neutral schema and intentionally discards the former SWR cache.
 */
const replaceDexieCacheSchema = {
  migrate: ({ database }) => {
    for (const storeName of Array.from(database.objectStoreNames)) {
      database.deleteObjectStore(storeName);
    }
    database.createObjectStore(INDEXED_DB_RECORD_STORE, { keyPath: 'key' });
  },
  name: 'replace_dexie_cache_schema',
  version: 11,
} satisfies IndexedDBMigration;

/** Append-only browser migration manifest. Released entries are immutable. */
export const indexedDBMigrations = [replaceDexieCacheSchema] as const;
export const INDEXED_DB_VERSION = indexedDBMigrations.at(-1)!.version;

const validateManifest = (migrations: readonly IndexedDBMigration[]) => {
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index].version <= migrations[index - 1].version) {
      throw new Error('IndexedDB migrations must be ordered by increasing version');
    }
  }
};

export const runIndexedDBMigrations = (
  database: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
  newVersion: number,
  migrations: readonly IndexedDBMigration[] = indexedDBMigrations,
): void => {
  validateManifest(migrations);

  for (const migration of migrations) {
    if (migration.version > oldVersion && migration.version <= newVersion) {
      migration.migrate({ database, transaction });
    }
  }
};
