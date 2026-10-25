import { replicaStorageKey } from './defineReplica';
import type { ReplicaEntityAdapter, ReplicaOptimisticToken, ReplicaStorePort } from './engine';
import {
  hasPagedItem,
  mapPagedItem,
  type ReplicaPagedData,
  type ReplicaPagingConfig,
} from './paging';
import { DROP_ROW, type ReplicaPersistedRows } from './persistedRows';
import type { ReplicaEntityRemovalGuards } from './removalGuards';
import type { ReplicaResource, ReplicaSource, ReplicaState } from './types';

export interface ReplicaEntityPropagationDeps<TData> {
  beginOptimistic: (key: string, apply: (data: TData) => TData) => ReplicaOptimisticToken<TData>;
  /** Non-paged resources: how entities sit in the value. */
  entity?: ReplicaEntityAdapter<TData, any>;
  entityGuards: ReplicaEntityRemovalGuards;
  getSlot: () => ReplicaState<TData>;
  paging?: ReplicaPagingConfig<any, any>;
  port: ReplicaStorePort<TData>;
  remove: (key: string) => boolean;
  resource: ReplicaResource<any, TData, any>;
  rows: ReplicaPersistedRows<TData>;
  update: (
    key: string,
    apply: (data: TData | undefined) => TData | undefined,
    options?: { persist?: boolean; seedTag?: string; source?: ReplicaSource },
  ) => boolean;
}

/**
 * Entity propagation: a change to one entity (e.g. a topic) applied to every
 * entry that holds it — in memory, in persisted rows memory does not hold,
 * and in rows a hydrate reads back while a removal is still landing.
 */
export const createEntityPropagation = <TData>({
  beginOptimistic,
  entity,
  entityGuards,
  getSlot,
  paging,
  port,
  remove,
  resource,
  rows,
  update,
}: ReplicaEntityPropagationDeps<TData>) => {
  const entityKeys = (id: string): string[] => {
    const keys = port.keys?.() ?? Object.keys(getSlot().entries);
    return keys.filter((key) => {
      const data = port.read(key);
      if (data === undefined) return false;
      if (paging) return hasPagedItem(data as any, id, paging);
      return entity ? entity.has(data, id) : false;
    });
  };

  /** Map one entity inside a value; `undefined` means the whole value goes away. */
  const mapEntity = <TItem>(
    data: TData,
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ): TData | undefined => {
    if (paging) return mapPagedItem(data as any, id, fn as any, paging) as TData;
    if (!entity || !entity.has(data, id)) return data;
    return entity.map(data, id, fn);
  };

  /** Which of `ids` are held by `data`. */
  const heldEntities = (data: TData, ids: string[]): string[] => {
    if (paging) {
      const items = (data as unknown as ReplicaPagedData<unknown, unknown>).items ?? [];
      const present = new Set(items.map((item) => paging.getId(item)));
      return ids.filter((id) => present.has(id));
    }
    return entity ? ids.filter((id) => entity.has(data, id)) : [];
  };

  /** Strip entities removed in `scope` from a value read back from storage. */
  const withoutRemovedEntities = (scope: string, data: TData): TData | undefined => {
    const removed = entityGuards.removedIds(scope);
    if (removed.length === 0) return data;
    let next: TData | undefined = data;
    for (const id of heldEntities(data, removed)) {
      next = mapEntity(next!, id, () => undefined);
      if (next === undefined) break;
    }
    return next;
  };

  /** A server value holding a removed entity again (restored) lifts its guard. */
  const forgetRestoredEntities = (scope: string, data: TData | undefined) => {
    const removed = entityGuards.removedIds(scope);
    if (removed.length === 0 || data === undefined) return;
    entityGuards.liftEntityGuards(scope, heldEntities(data, removed));
  };

  /**
   * Apply an entity change to persisted rows that memory does not hold (the
   * memory path already persists loaded entries). Read-modify-write runs in
   * the per-key write queue, so it sees every earlier write; a missing row is
   * never recreated. Resolves once the patches have settled: `true` when every
   * unloaded row is known to be patched (or nothing is persisted), `false` when
   * a row may still hold the old entity (untrusted scope, unreadable index or
   * row, a failed write, an identity switch mid-pass).
   */
  const patchStoredEntityRows = async <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
    scope: string = resource.scope.get(),
  ): Promise<boolean> => {
    if (!resource.storage) return true;
    if (!resource.scope.canPersist()) return false;
    // A scope left behind is patched on purpose: nothing of it is loaded, and an
    // identity switch while reading its index does not make its rows foreign.
    const offScope = scope !== resource.scope.get();
    const slot = getSlot();
    // Rows memory holds are patched through memory — but only in the active
    // scope; a view still showing a scope left behind is not what it persists.
    const loaded = new Set(
      !offScope && slot.scope === scope
        ? Object.entries(slot.entries).map(([key, entry]) => replicaStorageKey(key, entry.query))
        : [],
    );
    let keys: string[];
    try {
      keys = await rows.readIndex(scope);
    } catch (error) {
      // Rows cannot be enumerated: nothing to patch. Loaded entries are already
      // updated, and a removal keeps guarding later hydrates (`removeEntity`).
      console.error(`[replica:${resource.name}] failed to read the persisted index`, error);
      return false;
    }
    // Identity changed while reading the index: those rows are not ours to touch.
    if (!offScope && resource.scope.get() !== scope) return false;
    // Rows this session wrote to the scope may not be in the persisted index yet
    // (their row or index write is still queued — e.g. just before an account
    // switch). Patch them too: each patch is queued behind the row's own write,
    // so it reads the row once that write landed.
    for (const queryKey of rows.indexedKeys(scope) ?? [])
      if (!keys.includes(queryKey)) keys.push(queryKey);
    const patches: Promise<boolean>[] = [];
    for (const queryKey of keys) {
      if (loaded.has(queryKey)) continue;
      patches.push(
        rows.patchRow(scope, queryKey, (data) => {
          const next = mapEntity(data, id, fn);
          if (next === data) return undefined;
          return next === undefined ? DROP_ROW : next;
        }),
      );
    }
    return (await Promise.all(patches)).every(Boolean);
  };

  const patchStoredEntity = async <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ): Promise<void> => {
    await patchStoredEntityRows(id, fn);
  };

  /**
   * `updateEntity`, returning the persisted-row patch (if any) to wait on —
   * `true` once every unloaded row is patched.
   */
  const applyEntity = <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
    { persist = true }: { persist?: boolean } = {},
  ): Promise<boolean> | undefined => {
    const patch = persist ? patchStoredEntityRows(id, fn) : undefined;
    for (const key of entityKeys(id)) {
      const current = port.read(key);
      if (current === undefined) continue;
      const next = mapEntity(current, id, fn);
      if (next === undefined) remove(key);
      else
        update(key, (data) => (data === undefined ? data : (mapEntity(data, id, fn) ?? data)), {
          persist,
        });
    }
    return patch;
  };

  /**
   * An entity patch started for a scope that was not active settled. If the
   * user switched back to that scope meanwhile, an entry may have hydrated the
   * pre-patch row before the patch landed: apply the same change to what is
   * loaded now, in memory only — storage already holds it.
   */
  const reconcileLoaded = <TItem>(
    scope: string,
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ) => {
    if (resource.scope.get() !== scope || getSlot().scope !== scope) return;
    for (const key of entityKeys(id)) {
      const current = port.read(key);
      if (current === undefined) continue;
      // A hydrate during the patch may have recorded the pre-patch row as stored.
      rows.forgetStored(scope, [replicaStorageKey(key, getSlot().entries[key]?.query)]);
      if (mapEntity(current, id, fn) === undefined) remove(key);
      else
        update(key, (data) => (data === undefined ? data : (mapEntity(data, id, fn) ?? data)), {
          persist: false,
        });
    }
  };

  /**
   * Confirmed patch of one entity everywhere it is loaded and in the persisted
   * rows of unloaded entries. `scope` targets a scope captured earlier (a
   * write confirmed after the account switched): when it is no longer active,
   * only that scope's persisted rows are patched and the view on screen —
   * another identity's — is left alone.
   */
  const updateEntity = <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
    options?: { persist?: boolean; scope?: string },
  ) => {
    if (options?.scope !== undefined && options.scope !== resource.scope.get()) {
      const scope = options.scope;
      if (options.persist === false) return;
      const settle = () => reconcileLoaded(scope, id, fn);
      void patchStoredEntityRows(id, fn, scope).then(settle, settle);
      return;
    }
    void applyEntity(id, fn, options);
  };

  /**
   * Confirmed removal of one entity everywhere (see `updateEntity`, including
   * its captured `scope`). Unlike a plain mapper returning `undefined`, it is
   * also remembered for that scope:
   * a value hydrated afterwards — even by a read already in flight — comes
   * back without the entity (see `createEntityRemovalGuards`).
   */
  const removeEntity = (id: string, options?: { persist?: boolean; scope?: string }) => {
    const scope = options?.scope ?? resource.scope.get();
    // A removal confirmed after the account switched belongs to the scope that
    // asked for it: guard and patch that scope's rows, never the active view.
    const offScope = scope !== resource.scope.get();
    const release = entityGuards.guardEntity(scope, id);
    // A scope left behind has nothing on screen: only its persisted rows drop
    // the entity, and the guard keeps a later hydrate there from reading it back.
    const patch = offScope
      ? options?.persist === false
        ? undefined
        : patchStoredEntityRows(id, () => undefined, scope).then((patched) => {
            // Switched back meanwhile: drop it from anything hydrated since.
            reconcileLoaded(scope, id, () => undefined);
            return patched;
          })
      : applyEntity(id, () => undefined, options);
    // Without a storage patch (`persist: false`) only reads already in flight
    // can hold the entity; with one, reads that start before it lands can too.
    // A patch that did not land (untrusted scope, unreadable index or row, a
    // failed write, an identity switch) leaves the entity in an unloaded row:
    // every later hydrate of that row could resurrect it, so the guard is kept
    // — until a server value holds the entity again, or a later removal of the
    // same id lands its patch.
    if (patch)
      void patch.then(
        (patched) => {
          if (patched) release();
        },
        () => undefined,
      );
    else release();
  };

  const beginEntityOptimistic = <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ): ReplicaOptimisticToken<TData>[] =>
    entityKeys(id).flatMap((key) => {
      // Removing a whole value (a detail) is applied on commit, not optimistically.
      if (!paging) {
        const current = port.read(key);
        if (current !== undefined && mapEntity(current, id, fn) === undefined) return [];
      }
      return [beginOptimistic(key, (data) => mapEntity(data, id, fn) ?? data)];
    });

  return {
    beginEntityOptimistic,
    entityKeys,
    forgetRestoredEntities,
    patchStoredEntity,
    removeEntity,
    updateEntity,
    withoutRemovedEntities,
  };
};
