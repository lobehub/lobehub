import type { ReplicaRow, ReplicaRowKey, ReplicaStorage } from './types';

/**
 * Serializes writes for one projection key. A later snapshot can never be overwritten by an
 * earlier, slower IndexedDB write.
 */
export class ReplicaWriteQueue<T> {
  readonly #pending = new Map<string, Promise<void>>();
  readonly #storage: ReplicaStorage<T>;

  constructor(storage: ReplicaStorage<T>) {
    this.#storage = storage;
  }

  #id = ({ queryKey, scope }: ReplicaRowKey) => `${scope}:${queryKey}`;

  remove = (key: ReplicaRowKey): Promise<boolean> =>
    this.#enqueue(key, () => this.#storage.remove(key));

  set = (key: ReplicaRowKey, value: ReplicaRow<T>): Promise<boolean> =>
    this.#enqueue(key, () => this.#storage.set(key, value));

  /**
   * Serialized read-modify-write: `fn` sees the row as of every earlier queued
   * write for this key. Return a projection to write it, `null` to remove the
   * row, or `undefined` to leave it untouched (a missing row stays missing).
   */
  update = (
    key: ReplicaRowKey,
    fn: (current: ReplicaRow<T> | undefined) => ReplicaRow<T> | null | undefined,
  ): Promise<boolean> =>
    this.#enqueue(key, async () => {
      const next = fn(await this.#storage.get(key));
      if (next === null) await this.#storage.remove(key);
      else if (next !== undefined) await this.#storage.set(key, next);
    });

  /**
   * Queue `operation` behind the earlier writes for this key and report whether
   * it settled successfully. A failed write never rejects the returned promise:
   * the caller decides what to do (e.g. keep a removal retryable), while a
   * rejection on the queue itself is already swallowed so one bad write cannot
   * poison the chain.
   */
  #enqueue = (key: ReplicaRowKey, operation: () => Promise<void>): Promise<boolean> => {
    const id = this.#id(key);
    const previous = this.#pending.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.#pending.set(id, current);
    const settled = current.then(
      () => true,
      () => false,
    );
    void settled.finally(() => {
      if (this.#pending.get(id) === current) this.#pending.delete(id);
    });
    return settled;
  };
}
