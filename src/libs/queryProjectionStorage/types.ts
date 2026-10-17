export interface QueryProjectionKey {
  queryKey: string;
  scope: string;
}

export interface QueryProjection<T> {
  data: T;
  updatedAt: number;
}

export interface QueryProjectionStorage<T> {
  get: (key: QueryProjectionKey) => Promise<QueryProjection<T> | undefined>;
  /**
   * Like `get`, but rejects when the row could not be read. Required: a replica
   * refuses destructive passes (remove / clear / entity patch / eviction) on a
   * storage without it.
   */
  getStrict: (key: QueryProjectionKey) => Promise<QueryProjection<T> | undefined>;
  /** Rejects when the delete did not land (reads and writes stay best-effort). */
  remove: (key: QueryProjectionKey) => Promise<void>;
  /** Rejects when the write did not land (see `ReplicaStorage.set`). */
  set: (key: QueryProjectionKey, projection: QueryProjection<T>) => Promise<void>;
}

export interface QueryProjectionCodec<T> {
  parse: (value: string) => QueryProjection<T>;
  stringify: (projection: QueryProjection<T>) => string;
}
