import type { ReplicaRow, ReplicaRowKey, ReplicaStorage } from '../core/types';
import { replicaRowStoreKey } from './keyValue';

/** Turns a row into the string `localStorage` holds, and back. */
export interface ReplicaRowCodec<T> {
  parse: (value: string) => ReplicaRow<T>;
  stringify: (row: ReplicaRow<T>) => string;
}

export interface LocalStorageReplicaStorageOptions<T> {
  /** Defaults to JSON. Pass a richer codec (e.g. superjson) for `Date`, `Map` … */
  codec?: ReplicaRowCodec<T>;
  /** Prefix of every row of this storage, usually the resource name. */
  namespace: string;
}

const jsonCodec: ReplicaRowCodec<any> = { parse: JSON.parse, stringify: JSON.stringify };

/**
 * {@link ReplicaStorage} over `window.localStorage`. Small values only (the
 * origin shares a ~5 MB quota), but the read is synchronous: `getSync` restores
 * a row inside pre-paint initialization without yielding a frame. Outside a
 * browser every operation is a no-op miss.
 */
export class LocalStorageReplicaStorage<T> implements ReplicaStorage<T> {
  readonly #codec: ReplicaRowCodec<T>;
  readonly #namespace: string;

  constructor({ codec = jsonCodec, namespace }: LocalStorageReplicaStorageOptions<T>) {
    this.#codec = codec;
    this.#namespace = namespace;
  }

  #key = (key: ReplicaRowKey) => replicaRowStoreKey(this.#namespace, key);

  get = async (key: ReplicaRowKey): Promise<ReplicaRow<T> | undefined> => this.getSync(key);

  /** Restore a row inside pre-paint initialization without yielding a frame. */
  getSync = (key: ReplicaRowKey): ReplicaRow<T> | undefined => {
    if (typeof window === 'undefined') return undefined;

    try {
      const value = localStorage.getItem(this.#key(key));
      return value ? this.#codec.parse(value) : undefined;
    } catch {
      return undefined;
    }
  };

  /** Like `get`, but rejects when the row could not be read or parsed (see `ReplicaStorage.getStrict`). */
  getStrict = async (key: ReplicaRowKey): Promise<ReplicaRow<T> | undefined> => {
    if (typeof window === 'undefined') return undefined;

    const value = localStorage.getItem(this.#key(key));
    return value ? this.#codec.parse(value) : undefined;
  };

  /**
   * Rejects when the delete did not land (e.g. storage access denied), unlike
   * reads: a caller removing a row the user deleted must be able to retry it.
   */
  remove = async (key: ReplicaRowKey): Promise<void> => {
    if (typeof window === 'undefined') return;

    localStorage.removeItem(this.#key(key));
  };

  /**
   * Rejects when the write did not land (a quota error, see `ReplicaStorage.set`):
   * the replica engine only treats a row as holding a value after a confirmed
   * write.
   */
  set = async (key: ReplicaRowKey, row: ReplicaRow<T>): Promise<void> => {
    if (typeof window === 'undefined') return;

    localStorage.setItem(this.#key(key), this.#codec.stringify(row));
  };
}
