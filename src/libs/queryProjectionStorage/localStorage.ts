import type { QueryProjection, QueryProjectionKey, QueryProjectionStorage } from './types';

interface LocalStorageQueryProjectionStorageOptions<T> {
  deserialize?: (value: string) => QueryProjection<T>;
  namespace: string;
  serialize?: (projection: QueryProjection<T>) => string;
}

export class LocalStorageQueryProjectionStorage<T> implements QueryProjectionStorage<T> {
  readonly #deserialize: (value: string) => QueryProjection<T>;
  readonly #namespace: string;
  readonly #serialize: (projection: QueryProjection<T>) => string;

  constructor(options: LocalStorageQueryProjectionStorageOptions<T>) {
    this.#namespace = options.namespace;
    this.#deserialize = options.deserialize ?? JSON.parse;
    this.#serialize = options.serialize ?? JSON.stringify;
  }

  #key = ({ queryKey, scope }: QueryProjectionKey) =>
    `${this.#namespace}:${encodeURIComponent(scope)}:${encodeURIComponent(queryKey)}`;

  get = async (key: QueryProjectionKey): Promise<QueryProjection<T> | undefined> => {
    if (typeof window === 'undefined') return undefined;

    try {
      const value = localStorage.getItem(this.#key(key));
      return value ? this.#deserialize(value) : undefined;
    } catch {
      return undefined;
    }
  };

  remove = async (key: QueryProjectionKey): Promise<void> => {
    if (typeof window === 'undefined') return;

    try {
      localStorage.removeItem(this.#key(key));
    } catch {
      // Projection persistence is best-effort; the server remains the durable SoT.
    }
  };

  set = async (key: QueryProjectionKey, projection: QueryProjection<T>): Promise<void> => {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem(this.#key(key), this.#serialize(projection));
    } catch {
      // Projection persistence is best-effort; the server remains the durable SoT.
    }
  };
}
