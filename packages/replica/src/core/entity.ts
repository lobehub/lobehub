import type { ReplicaOptimisticToken } from './engine';

/** The part of a slice entity propagation needs (structural, so any slice fits). */
export interface ReplicaEntityTarget {
  beginEntityOptimistic: <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ) => ReplicaOptimisticToken<any>[];
  /** Patch persisted rows whose entry is not loaded in memory. */
  patchStoredEntity: <TItem>(id: string, fn: (item: TItem) => TItem | undefined) => Promise<void>;
  revalidate: (key?: string) => Promise<unknown>;
  updateEntity: <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
    options?: { persist?: boolean },
  ) => void;
}

/**
 * Link resources that hold copies of the same entity (e.g. a topic in the
 * sidebar list, the management page and the detail cache).
 *
 * Each resource keeps exactly one store location and decides how the entity
 * maps into its own shape (paged resources by `getId`, single-entity ones by
 * their entity adapter). The link only fans an entity-level change out to the
 * resources that currently hold it — no global event bus, no shared owner.
 */
export const linkReplicaEntity = <TItem>(targets: ReplicaEntityTarget[]) => {
  /**
   * Confirmed patch everywhere the entity is loaded, and (when persisted, the
   * default) in persisted rows of entries that are not loaded.
   */
  const update = (
    id: string,
    fn: (item: TItem) => TItem,
    options?: { persist?: boolean },
  ): void => {
    for (const target of targets) target.updateEntity<TItem>(id, fn, options);
  };

  /** Confirmed removal everywhere (list rows dropped, single-entity values removed). */
  const remove = (id: string, options?: { persist?: boolean }): void => {
    for (const target of targets) target.updateEntity<TItem>(id, () => undefined, options);
  };

  /**
   * One server call, one overlay per resource holding the entity: all commit
   * together or all roll back together (then rethrow). Pass `'remove'` for an
   * optimistic delete.
   */
  const optimistic = async <TResult>(
    id: string,
    fn: ((item: TItem) => TItem) | 'remove',
    serverCall: () => Promise<TResult>,
  ): Promise<TResult> => {
    const apply = fn === 'remove' ? () => undefined : fn;
    const tokens = targets.flatMap((target) => target.beginEntityOptimistic<TItem>(id, apply));
    try {
      const result = await serverCall();
      for (const token of tokens) token.commit();
      // `remove` / `update` also patch persisted rows that are not loaded.
      if (fn === 'remove') remove(id);
      else for (const target of targets) void target.patchStoredEntity<TItem>(id, fn);
      return result;
    } catch (error) {
      for (const token of tokens) token.rollback();
      throw error;
    }
  };

  const revalidate = () => Promise.all(targets.map((target) => target.revalidate()));

  return { optimistic, remove, revalidate, update };
};
