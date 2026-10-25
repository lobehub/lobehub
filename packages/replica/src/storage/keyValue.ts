import type { ReplicaRow, ReplicaRowKey, ReplicaStorage } from '../core/types';

/**
 * An async key-value store a replica can persist into: an IndexedDB object
 * store, a SQLite table behind IPC, a `Map` in tests. Values are stored as
 * given (structured clone), so the store decides what it can hold.
 */
export interface ReplicaKeyValueStore {
  /** Rejects when the delete did not land. A missing key is a success. */
  delete: (key: string) => Promise<void>;
  /** Rejects when the read failed; resolves `undefined` for a missing key. */
  get: (key: string) => Promise<unknown>;
  /** Opens the store; awaited before every operation. */
  initialize?: () => Promise<void>;
  /** Rejects when the write did not land. */
  set: (key: string, value: unknown) => Promise<void>;
}

export interface KeyValueReplicaStorageOptions {
  /** Prefix of every row of this storage, usually the resource name. */
  namespace: string;
  store: ReplicaKeyValueStore;
}

/** Store key of one row: `<namespace>:<scope>:<queryKey>`, each part URI-encoded but the namespace. */
export const replicaRowStoreKey = (namespace: string, { queryKey, scope }: ReplicaRowKey) =>
  `${namespace}:${encodeURIComponent(scope)}:${encodeURIComponent(queryKey)}`;

/** {@link ReplicaStorage} over an async key-value store, one record per row. */
export class KeyValueReplicaStorage<T> implements ReplicaStorage<T> {
  readonly #namespace: string;
  readonly #store: ReplicaKeyValueStore;

  constructor({ namespace, store }: KeyValueReplicaStorageOptions) {
    this.#namespace = namespace;
    this.#store = store;
  }

  #key = (key: ReplicaRowKey) => replicaRowStoreKey(this.#namespace, key);

  get = async (key: ReplicaRowKey): Promise<ReplicaRow<T> | undefined> => {
    try {
      return await this.getStrict(key);
    } catch {
      return undefined;
    }
  };

  /** Like `get`, but rejects when the row could not be read (see `ReplicaStorage.getStrict`). */
  getStrict = async (key: ReplicaRowKey): Promise<ReplicaRow<T> | undefined> => {
    await this.#store.initialize?.();
    return (await this.#store.get(this.#key(key))) as ReplicaRow<T> | undefined;
  };

  /**
   * Rejects when the delete did not land, unlike reads: a caller that removes a
   * row the user deleted must be able to retry it.
   */
  remove = async (key: ReplicaRowKey): Promise<void> => {
    await this.#store.initialize?.();
    await this.#store.delete(this.#key(key));
  };

  /**
   * Rejects when the write did not land (see `ReplicaStorage.set`): the replica
   * engine only treats a row as holding a value after a confirmed write, so a
   * dropped write is retried by the next persist instead of being skipped as
   * redundant.
   */
  set = async (key: ReplicaRowKey, row: ReplicaRow<T>): Promise<void> => {
    await this.#store.initialize?.();
    await this.#store.set(this.#key(key), row);
  };
}
