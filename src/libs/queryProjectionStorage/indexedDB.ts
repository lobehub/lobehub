import { localDatabase } from '@/libs/localDatabase';

import type { QueryProjection, QueryProjectionKey, QueryProjectionStorage } from './types';

interface IndexedDBQueryProjectionStorageOptions {
  namespace: string;
}

const COLLECTION = 'query-projections';

export class IndexedDBQueryProjectionStorage<T> implements QueryProjectionStorage<T> {
  readonly #namespace: string;

  constructor({ namespace }: IndexedDBQueryProjectionStorageOptions) {
    this.#namespace = namespace;
  }

  #key = ({ queryKey, scope }: QueryProjectionKey) =>
    `${this.#namespace}:${encodeURIComponent(scope)}:${encodeURIComponent(queryKey)}`;

  get = async (key: QueryProjectionKey): Promise<QueryProjection<T> | undefined> => {
    try {
      await localDatabase.initialize();
      return await localDatabase.get<QueryProjection<T>>(COLLECTION, this.#key(key));
    } catch {
      return undefined;
    }
  };

  remove = async (key: QueryProjectionKey): Promise<void> => {
    try {
      await localDatabase.initialize();
      await localDatabase.delete(COLLECTION, this.#key(key));
    } catch {
      // Projection persistence is best-effort; the server remains the durable SoT.
    }
  };

  set = async (key: QueryProjectionKey, projection: QueryProjection<T>): Promise<void> => {
    try {
      await localDatabase.initialize();
      await localDatabase.set(COLLECTION, this.#key(key), projection);
    } catch {
      // Projection persistence is best-effort; the server remains the durable SoT.
    }
  };
}
