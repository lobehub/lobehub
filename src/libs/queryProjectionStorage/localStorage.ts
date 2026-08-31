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

  get = async (key: QueryProjectionKey): Promise<QueryProjection<T> | undefined> => {
    if (typeof window === 'undefined') return undefined;

    try {
      const value = localStorage.getItem(this.#key(key));
      return value ? this.#codec.parse(value) : undefined;
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
      localStorage.setItem(this.#key(key), this.#codec.stringify(projection));
    } catch {
      // Projection persistence is best-effort; the server remains the durable SoT.
    }
  };
}
