import { createIndexedDBLocalDatabaseAdapter } from './indexedDBAdapter';
import type { LocalDatabaseAdapter, LocalDatabaseBatchOperation } from './types';

export type {
  LocalDatabaseAdapter,
  LocalDatabaseBatchOperation,
  LocalDatabaseCollectionInfo,
  LocalDatabaseEntry,
} from './types';

let activeAdapter: LocalDatabaseAdapter = createIndexedDBLocalDatabaseAdapter();

/**
 * Replace the local database implementation before application initialization.
 * Electron can register a SQLite IPC adapter from its renderer entry point.
 */
export const registerLocalDatabaseAdapter = (adapter: LocalDatabaseAdapter): (() => void) => {
  const previousAdapter = activeAdapter;
  activeAdapter = adapter;

  return () => {
    if (activeAdapter === adapter) activeAdapter = previousAdapter;
  };
};

/** Runtime-neutral local database used by persistence repositories. */
export const localDatabase = {
  batch: (operations: LocalDatabaseBatchOperation[]): Promise<void> =>
    activeAdapter.batch(operations),
  delete: (collection: string, key: string): Promise<void> => activeAdapter.delete(collection, key),
  deleteByPrefix: (collection: string, prefix: string): Promise<void> =>
    activeAdapter.deleteByPrefix(collection, prefix),
  entriesByPrefix: <T>(collection: string, prefix: string) =>
    activeAdapter.entriesByPrefix<T>(collection, prefix),
  get: <T>(collection: string, key: string): Promise<T | undefined> =>
    activeAdapter.get<T>(collection, key),
  initialize: (): Promise<void> => activeAdapter.initialize(),
  listCollections: () => activeAdapter.listCollections(),
  set: (collection: string, key: string, value: unknown): Promise<void> =>
    activeAdapter.set(collection, key, value),
};
