export interface LocalDatabaseEntry<T = unknown> {
  key: string;
  value: T;
}

export type LocalDatabaseBatchOperation =
  | {
      collection: string;
      key: string;
      type: 'delete';
    }
  | {
      collection: string;
      key: string;
      type: 'set';
      value: unknown;
    };

/**
 * Runtime-independent local key/value database contract.
 *
 * Collections are logical namespaces rather than physical tables, allowing
 * both IndexedDB and SQLite IPC implementations to expose identical behavior.
 */
export interface LocalDatabaseAdapter {
  batch: (operations: LocalDatabaseBatchOperation[]) => Promise<void>;
  delete: (collection: string, key: string) => Promise<void>;
  deleteByPrefix: (collection: string, prefix: string) => Promise<void>;
  entriesByPrefix: <T>(collection: string, prefix: string) => Promise<LocalDatabaseEntry<T>[]>;
  get: <T>(collection: string, key: string) => Promise<T | undefined>;
  initialize: () => Promise<void>;
  set: (collection: string, key: string, value: unknown) => Promise<void>;
}
