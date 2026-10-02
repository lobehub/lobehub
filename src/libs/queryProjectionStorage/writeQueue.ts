import type { QueryProjection, QueryProjectionKey, QueryProjectionStorage } from './types';

/**
 * Serializes writes for one projection key. A later snapshot can never be overwritten by an
 * earlier, slower IndexedDB write.
 */
export class QueryProjectionWriteQueue<T> {
  readonly #pending = new Map<string, Promise<void>>();
  readonly #storage: QueryProjectionStorage<T>;

  constructor(storage: QueryProjectionStorage<T>) {
    this.#storage = storage;
  }

  #id = ({ queryKey, scope }: QueryProjectionKey) => `${scope}:${queryKey}`;

  remove = (key: QueryProjectionKey): void => {
    this.#enqueue(key, () => this.#storage.remove(key));
  };

  set = (key: QueryProjectionKey, value: QueryProjection<T>): void => {
    this.#enqueue(key, () => this.#storage.set(key, value));
  };

  /**
   * Serialized read-modify-write: `fn` sees the row as of every earlier queued
   * write for this key. Return a projection to write it, `null` to remove the
   * row, or `undefined` to leave it untouched (a missing row stays missing).
   */
  update = (
    key: QueryProjectionKey,
    fn: (current: QueryProjection<T> | undefined) => QueryProjection<T> | null | undefined,
  ): void => {
    this.#enqueue(key, async () => {
      const next = fn(await this.#storage.get(key));
      if (next === null) await this.#storage.remove(key);
      else if (next !== undefined) await this.#storage.set(key, next);
    });
  };

  #enqueue = (key: QueryProjectionKey, operation: () => Promise<void>): void => {
    const id = this.#id(key);
    const previous = this.#pending.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.#pending.set(id, current);
    void current
      .catch(() => undefined)
      .finally(() => {
        if (this.#pending.get(id) === current) this.#pending.delete(id);
      });
  };
}
