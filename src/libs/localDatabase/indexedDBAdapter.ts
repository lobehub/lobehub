import {
  INDEXED_DB_NAME,
  INDEXED_DB_RECORD_STORE,
  INDEXED_DB_VERSION,
  runIndexedDBMigrations,
} from './indexedDBMigrations';
import type {
  LocalDatabaseAdapter,
  LocalDatabaseBatchOperation,
  LocalDatabaseCollectionInfo,
  LocalDatabaseEntry,
} from './types';

interface IndexedDBRecord {
  key: string;
  value: unknown;
}

const COLLECTION_SEPARATOR = '\u0000';

const collectionPrefix = (collection: string) => `${collection}${COLLECTION_SEPARATOR}`;
const storageKey = (collection: string, key: string) => `${collectionPrefix(collection)}${key}`;
const collectionFromStorageKey = (key: IDBValidKey): string | undefined => {
  if (typeof key !== 'string') return undefined;
  const separatorIndex = key.indexOf(COLLECTION_SEPARATOR);
  return separatorIndex < 0 ? undefined : key.slice(0, separatorIndex);
};
const storageRange = (collection: string, prefix: string) => {
  const lowerBound = storageKey(collection, prefix);
  return IDBKeyRange.bound(lowerBound, `${lowerBound}\uFFFF`);
};

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    request.onsuccess = () => resolve(request.result);
  });

const transactionCompletion = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.oncomplete = () => resolve();
  });

const openDatabase = (onVersionChange: () => void): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
    let settled = false;

    request.onblocked = () => {
      settled = true;
      reject(new Error('IndexedDB upgrade was blocked by another LobeHub tab'));
    };
    request.onerror = () => {
      settled = true;
      reject(request.error ?? new Error('Unable to open the local database'));
    };
    request.onupgradeneeded = (event) => {
      runIndexedDBMigrations(
        request.result,
        request.transaction!,
        event.oldVersion,
        event.newVersion ?? INDEXED_DB_VERSION,
      );
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }

      database.onversionchange = () => {
        database.close();
        onVersionChange();
      };
      settled = true;
      resolve(database);
    };
  });

export const createIndexedDBLocalDatabaseAdapter = (): LocalDatabaseAdapter => {
  let databasePromise: Promise<IDBDatabase> | null = null;

  const getDatabase = () => {
    if (!databasePromise) {
      const opening = openDatabase(() => {
        if (databasePromise === opening) databasePromise = null;
      });
      databasePromise = opening;
      void opening.catch(() => {
        if (databasePromise === opening) databasePromise = null;
      });
    }

    return databasePromise;
  };

  const runTransaction = async <T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await getDatabase();
    const transaction = database.transaction(INDEXED_DB_RECORD_STORE, mode);
    const completion = transactionCompletion(transaction);
    let request: IDBRequest<T>;

    try {
      request = operation(transaction.objectStore(INDEXED_DB_RECORD_STORE));
    } catch (error) {
      transaction.abort();
      await completion.catch(() => undefined);
      throw error;
    }

    const [result] = await Promise.all([requestResult(request), completion]);
    return result;
  };

  return {
    batch: async (operations: LocalDatabaseBatchOperation[]): Promise<void> => {
      if (operations.length === 0) return;

      const database = await getDatabase();
      const transaction = database.transaction(INDEXED_DB_RECORD_STORE, 'readwrite');
      const completion = transactionCompletion(transaction);
      const store = transaction.objectStore(INDEXED_DB_RECORD_STORE);

      try {
        for (const operation of operations) {
          const key = storageKey(operation.collection, operation.key);
          if (operation.type === 'delete') store.delete(key);
          else store.put({ key, value: operation.value } satisfies IndexedDBRecord);
        }
      } catch (error) {
        transaction.abort();
        await completion.catch(() => undefined);
        throw error;
      }

      await completion;
    },

    delete: async (collection: string, key: string): Promise<void> => {
      await runTransaction('readwrite', (store) => store.delete(storageKey(collection, key)));
    },

    deleteByPrefix: async (collection: string, prefix: string): Promise<void> => {
      await runTransaction('readwrite', (store) => store.delete(storageRange(collection, prefix)));
    },

    entriesByPrefix: async <T>(
      collection: string,
      prefix: string,
    ): Promise<LocalDatabaseEntry<T>[]> => {
      const records = await runTransaction<IndexedDBRecord[]>('readonly', (store) =>
        store.getAll(storageRange(collection, prefix)),
      );
      const keyOffset = collectionPrefix(collection).length;

      return records.map((record) => ({
        key: record.key.slice(keyOffset),
        value: record.value as T,
      }));
    },

    get: async <T>(collection: string, key: string): Promise<T | undefined> => {
      const record = await runTransaction<IndexedDBRecord | undefined>('readonly', (store) =>
        store.get(storageKey(collection, key)),
      );
      return record?.value as T | undefined;
    },

    initialize: async (): Promise<void> => {
      await getDatabase();
    },

    listCollections: async (): Promise<LocalDatabaseCollectionInfo[]> => {
      const keys = await runTransaction<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
      const counts = new Map<string, number>();

      for (const key of keys) {
        const collection = collectionFromStorageKey(key);
        if (collection === undefined) continue;
        counts.set(collection, (counts.get(collection) ?? 0) + 1);
      }

      return [...counts.entries()]
        .map(([name, entryCount]) => ({ entryCount, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    set: async (collection: string, key: string, value: unknown): Promise<void> => {
      await runTransaction('readwrite', (store) =>
        store.put({ key: storageKey(collection, key), value } satisfies IndexedDBRecord),
      );
    },
  };
};
