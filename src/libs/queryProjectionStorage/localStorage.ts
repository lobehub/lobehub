import superjson from 'superjson';

import type {
  QueryProjection,
  QueryProjectionCodec,
  QueryProjectionKey,
  QueryProjectionStorage,
} from './types';

interface LocalStorageQueryProjectionStorageOptions<T> {
  codec?: QueryProjectionCodec<T>;
  namespace: string;
}

export class LocalStorageQueryProjectionStorage<T> implements QueryProjectionStorage<T> {
  readonly #codec: QueryProjectionCodec<T>;
  readonly #namespace: string;

  constructor(options: LocalStorageQueryProjectionStorageOptions<T>) {
    this.#namespace = options.namespace;
    this.#codec = options.codec ?? {
      parse: superjson.parse<QueryProjection<T>>,
      stringify: superjson.stringify,
    };
  }

  #key = ({ queryKey, scope }: QueryProjectionKey) =>
    `${this.#namespace}:${encodeURIComponent(scope)}:${encodeURIComponent(queryKey)}`;

  get = async (key: QueryProjectionKey): Promise<QueryProjection<T> | undefined> =>
    this.getSync(key);

  /** Restore a local projection inside pre-paint initialization without yielding a frame. */
  getSync = (key: QueryProjectionKey): QueryProjection<T> | undefined => {
    if (typeof window === 'undefined') return undefined;

    try {
      const value = localStorage.getItem(this.#key(key));
      return value ? this.#codec.parse(value) : undefined;
    } catch {
      return undefined;
    }
  };

  /** Like `get`, but rejects when the row could not be read or parsed (see `ReplicaStorage.getStrict`). */
  getStrict = async (key: QueryProjectionKey): Promise<QueryProjection<T> | undefined> => {
    if (typeof window === 'undefined') return undefined;

    const value = localStorage.getItem(this.#key(key));
    return value ? this.#codec.parse(value) : undefined;
  };

  /**
   * Rejects when the delete did not land (e.g. storage access denied), unlike
   * reads and writes: a caller removing a row the user deleted must be able to
   * retry it.
   */
  remove = async (key: QueryProjectionKey): Promise<void> => {
    if (typeof window === 'undefined') return;

    localStorage.removeItem(this.#key(key));
  };

  /**
   * Rejects when the write did not land (a quota error, see `ReplicaStorage.set`):
   * the replica engine only treats a row as holding a value after a confirmed
   * write. Callers that persist best-effort catch it.
   */
  set = async (key: QueryProjectionKey, projection: QueryProjection<T>): Promise<void> => {
    if (typeof window === 'undefined') return;

    localStorage.setItem(this.#key(key), this.#codec.stringify(projection));
  };
}
