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
      return await this.getStrict(key);
    } catch {
      return undefined;
    }
  };

  /** Like `get`, but rejects when the row could not be read (see `ReplicaStorage.getStrict`). */
  getStrict = async (key: QueryProjectionKey): Promise<QueryProjection<T> | undefined> => {
    await localDatabase.initialize();
    return localDatabase.get<QueryProjection<T>>(COLLECTION, this.#key(key));
  };

  /**
   * Rejects when the delete did not land, unlike reads: a caller that removes a
   * row the user deleted must be able to retry it.
   */
  remove = async (key: QueryProjectionKey): Promise<void> => {
    await localDatabase.initialize();
    await localDatabase.delete(COLLECTION, this.#key(key));
  };

  /**
   * Rejects when the write did not land (see `ReplicaStorage.set`): the replica
   * engine only treats a row as holding a value after a confirmed write, so a
   * dropped write is retried by the next persist instead of being skipped as
   * redundant. Callers that persist best-effort catch it.
   */
  set = async (key: QueryProjectionKey, projection: QueryProjection<T>): Promise<void> => {
    await localDatabase.initialize();
    await localDatabase.set(COLLECTION, this.#key(key), projection);
  };
}
