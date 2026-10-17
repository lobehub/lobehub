import type { ReplicaRow, ReplicaRowKey, ReplicaStorage } from './types';

/**
 * Strict read of one row (see `ReplicaStorage.getStrict`). Rejects when the
 * storage has no strict read: its `get` swallows I/O failures into a miss, so a
 * destructive pass reading through it could take an unreadable row (the index)
 * for an empty one and report success for rows it never saw.
 */
export const readReplicaRowStrict = <T>(
  storage: ReplicaStorage<T>,
  key: ReplicaRowKey,
): Promise<ReplicaRow<T> | undefined> =>
  // Call through `storage`: a class-based storage needs its receiver.
  storage.getStrict
    ? storage.getStrict(key)
    : Promise.reject(
        new Error('[replica] storage has no `getStrict`: destructive passes are disabled'),
      );

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

  /** Resolves `false` when storage rejected the delete (see `ReplicaStorage.remove`). */
  remove = (key: ReplicaRowKey): Promise<boolean> =>
    this.#enqueue(key, () => this.#storage.remove(key));

  set = (key: ReplicaRowKey, value: ReplicaRow<T>): Promise<boolean> =>
    this.#enqueue(key, () => this.#storage.set(key, value));

  /**
   * Serialized read-modify-write: `fn` sees the row as of every earlier queued
   * write for this key. Return a projection to write it, `null` to remove the
   * row, or `undefined` to leave it untouched (a missing row stays missing).
   *
   * `read` picks how the row is read:
   * - `'get'` (default): best-effort `get`, a failed read passes for a miss.
   * - `'prefer-strict'`: `getStrict` when the storage has one, so a read failure
   *   fails the update (resolves `false`) instead of passing for a missing row
   *   that `fn` would then overwrite; `get` otherwise.
   * - `'strict'`: `getStrict` only; a storage without it fails the update.
   *   Required for destructive passes (see `readReplicaRowStrict`).
   */
  update = (
    key: ReplicaRowKey,
    fn: (current: ReplicaRow<T> | undefined) => ReplicaRow<T> | null | undefined,
    { read = 'get' }: { read?: 'get' | 'prefer-strict' | 'strict' } = {},
  ): Promise<boolean> =>
    this.#enqueue(key, async () => {
      const storage = this.#storage;
      const strict = read === 'strict' || (read === 'prefer-strict' && !!storage.getStrict);
      const current = await (strict ? readReplicaRowStrict(storage, key) : storage.get(key));
      const next = fn(current);
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
