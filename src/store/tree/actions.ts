import { createReplicaSlice, recordLens } from '@/libs/replica';
import { subscribeCacheScope } from '@/libs/replica/cacheScopeEvents';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { fileService } from '@/services/file';
import { resourceService } from '@/services/resource';
import type { StoreSetter } from '@/store/types';
import { OptimisticEngine } from '@/store/utils/optimisticEngine';

import { revalidateHierarchySearch, sortTreeItems, toTreeItem } from './items';
import {
  buildLibraryTreeSnapshot,
  libraryTreeResource,
  type LibraryTreeSnapshot,
  MAX_PERSISTED_FOLDERS,
} from './projection';
import type { TreeDataState, TreeItem, TreeState, TreeStoreHandle } from './types';

export {
  revalidateHierarchySearch,
  sortTreeItems,
  toTreeItem,
  toTreeItemFromResource,
} from './items';

type Setter = StoreSetter<TreeState>;

export class TreeActionImpl {
  readonly #get: () => TreeState;
  readonly #set: Setter;
  #engine?: { engine: OptimisticEngine<TreeDataState>; epoch: number };
  readonly #snapshot;
  #storeHandle: TreeStoreHandle;
  /** Cache scope the rendered tree was loaded under. */
  #treeScope?: string;

  constructor(set: Setter, get: () => TreeState) {
    this.#set = set;
    this.#get = get;
    this.#snapshot = createReplicaSlice(libraryTreeResource, {
      actionPrefix: 'libraryTree',
      get,
      set,
      stateKey: 'snapshotReplica',
      view: recordLens<TreeState, LibraryTreeSnapshot>('snapshotMap'),
    });
    this.#storeHandle = {
      getState: () => ({
        children: get().children,
        status: get().status,
      }),
      setState: (next) => set(next as Partial<TreeState>, false, 'tree/engineSetState'),
    };

    // Nothing renders this store's replica through `useSync`, so it would never
    // see an identity switch: a cold boot can seed the tree from the last
    // user's partition before identity resolves to someone else. The store is
    // an app-lifetime singleton, so the subscription is never torn down.
    subscribeCacheScope((scope) => this.#dropStaleScope(scope));
  }

  /**
   * Drop the previous identity's snapshot and rendered tree, then load the open
   * library again under the new scope. A no-op when the tree already belongs to
   * `scope`, which is the common case: identity resolving to the scope the cold
   * boot guessed.
   */
  #dropStaleScope = (scope: string): void => {
    this.#snapshot.ensureScope(scope);
    const { knowledgeBaseId } = this.#get();
    if (!knowledgeBaseId || this.#treeScope === scope) return;

    this.reset();
    this.init(knowledgeBaseId);
  };

  /**
   * One engine per tree epoch. A reset (scope switch, another library) retires
   * the previous engine: a transaction still in flight there must not roll its
   * inverse patches onto the tree that replaced the one it patched.
   */
  #getEngine = () => {
    const { epoch } = this.#get();
    if (this.#engine?.epoch === epoch) return this.#engine.engine;
    const handle: TreeStoreHandle = {
      getState: this.#storeHandle.getState,
      setState: (next) => {
        if (this.#get().epoch === epoch) this.#storeHandle.setState(next);
      },
    };
    this.#engine = { engine: new OptimisticEngine(handle, { maxRetries: 1 }), epoch };
    return this.#engine.engine;
  };

  /**
   * Folders whose refresh was requested while a fetch for them was already in
   * flight. That fetch captured its snapshot before the change the caller is
   * revealing (a create from the sidebar "+" during the initial root load, a
   * move landing while the destination is still loading), so dropping the
   * request would leave the new row out of the tree until something else
   * refreshed it. One follow-up runs once the in-flight fetch settles; repeated
   * requests collapse into that one.
   */
  #queuedRevalidate = new Set<string>();

  /**
   * Folders whose rendered rows are not confirmed by the server: an explorer
   * list with optimistic overlays still pending (see `reconcile`), or a folder
   * whose refresh failed during `revalidateLoaded`. The snapshot keeps their
   * last confirmed rows; the explorer's settle or a server answer for the
   * folder clears it.
   */
  #unconfirmedFolders = new Set<string>();

  /** Sidebar transactions (move, rename, delete) whose optimistic patch is not confirmed. */
  #pendingTx = new Set<symbol>();

  /**
   * Batched refreshes in flight (`revalidateLoaded`). The snapshot is written
   * once they all settle: persisting after each folder would store the rows of
   * the folders that have not been refetched yet, and for a delete only the
   * server can enumerate those rows are exactly the deleted ones.
   */
  #pendingBatch = 0;

  /**
   * Commit with the snapshot paused, then persist what survived (applied or
   * rolled back). Resolves `false` when the tree was reset meanwhile: the
   * caller's follow-up refresh would address the previous scope's folders.
   */
  #commitTracked = async (tx: { commit: () => Promise<unknown> }): Promise<boolean> => {
    const { epoch } = this.#get();
    const token = Symbol('tx');
    this.#pendingTx.add(token);
    try {
      await tx.commit();
    } finally {
      this.#pendingTx.delete(token);
      if (this.#get().epoch === epoch) this.#persistSnapshot();
    }
    return this.#get().epoch === epoch;
  };

  #runQueuedRevalidate = (folderId: string) => {
    if (!this.#queuedRevalidate.delete(folderId)) return;
    void this.revalidate(folderId);
  };

  /**
   * `children` is keyed by folder id, but the explorer addresses the current
   * folder by whatever the URL carries — usually the folder slug (see
   * `useFileStore.queryParams.parentId`). Writing under the slug leaves the
   * sidebar (which walks by id) blind to the update, so map a slug back to the
   * id of the already-loaded folder node. Unknown keys pass through unchanged.
   *
   * The loaded node wins over an existing `children[key]` entry: the explorer's
   * first list for a deep-linked folder arrives before its ancestors are
   * loaded and lands under the slug, and that stale entry must not keep every
   * later update pinned to the slug once the folder node is known.
   */
  #resolveFolderKey = (key: string): string => {
    if (!key) return '';
    const { children } = this.#get();
    for (const items of Object.values(children)) {
      const match = items.find((item) => item.isFolder && (item.id === key || item.slug === key));
      if (match) return match.id;
    }
    return key;
  };

  /**
   * Store the visible tree as the library's persisted snapshot. Runs after the
   * writes that settle a folder; the replica skips a write whose value did not
   * change, so a revalidation that confirms the tree costs no storage write.
   */
  #persistSnapshot = () => {
    if (this.#pendingTx.size > 0 || this.#pendingBatch > 0) return;
    const { children, expanded, knowledgeBaseId, snapshotMap } = this.#get();
    if (!knowledgeBaseId) return;
    // A folder showing the explorer's optimistic overlay keeps its last stored
    // rows (or is left out): a reload never repaints unconfirmed rows, and a
    // marker a navigation abandoned only pins its own folder.
    const confirmed = { ...children };
    const stored = snapshotMap[knowledgeBaseId]?.children ?? {};
    for (const id of this.#unconfirmedFolders) {
      if (stored[id]) confirmed[id] = stored[id];
      else delete confirmed[id];
    }
    const snapshot = buildLibraryTreeSnapshot(confirmed, expanded);
    if (!snapshot) return;
    this.#snapshot.update(knowledgeBaseId, () => snapshot);
  };

  /**
   * Fill in folders the network has not answered yet from the library's
   * persisted snapshot, then confirm each of them in the background. A folder
   * the network already settled keeps its fresh rows.
   */
  #seedFromSnapshot = (snapshot: LibraryTreeSnapshot) => {
    const { children, expanded } = this.#get();
    const seeded = Object.keys(snapshot.children).filter((folderId) => !children[folderId]);
    if (seeded.length === 0) return;

    const nextChildren = { ...children };
    for (const folderId of seeded) nextChildren[folderId] = snapshot.children[folderId];
    const nextExpanded = { ...expanded };
    for (const folderId of snapshot.expanded) {
      if (nextExpanded[folderId] === undefined) nextExpanded[folderId] = true;
    }
    this.#set({ children: nextChildren, expanded: nextExpanded }, false, 'tree/seedFromSnapshot');

    // The root's own fetch (started by `init`) is already confirming it.
    for (const folderId of seeded) if (folderId) void this.#revalidateFolder(folderId);
  };

  #hydrateSnapshot = async (knowledgeBaseId: string, epoch: number) => {
    await this.preHydrate(knowledgeBaseId);
    if (this.#get().epoch !== epoch) return;
    const snapshot = this.#get().snapshotMap[knowledgeBaseId];
    if (snapshot) this.#seedFromSnapshot(snapshot);
  };

  preHydrate = (knowledgeBaseId: string): Promise<boolean> => {
    const scope = getCacheScope();
    // The slot may still hold the previous identity's rows; drop them before seeding.
    this.#snapshot.ensureScope(scope);
    return this.#snapshot.hydrate({ libraryId: knowledgeBaseId }, scope);
  };

  init = (knowledgeBaseId: string) => {
    const current = this.#get();
    // Remounting the library already in memory (leaving the page and coming
    // back): keep the tree on screen and confirm what is loaded in the
    // background, instead of wiping it back to a skeleton.
    if (current.knowledgeBaseId === knowledgeBaseId && current.children['']) {
      this.#revalidateOnRemount();
      return;
    }

    this.#queuedRevalidate.clear();
    this.#unconfirmedFolders.clear();
    this.#pendingTx.clear();
    this.#treeScope = getCacheScope();
    const epoch = current.epoch + 1;
    this.#set(
      {
        children: {},
        epoch,
        errors: {},
        expanded: {},
        knowledgeBaseId,
        status: {},
      },
      false,
      'tree/init',
    );

    // The route loader usually hydrated the snapshot already, so the tree
    // paints in this very commit; otherwise it lands as soon as storage answers.
    const snapshot = current.snapshotMap[knowledgeBaseId];
    if (snapshot) this.#seedFromSnapshot(snapshot);
    void this.loadChildren('');
    if (!snapshot) void this.#hydrateSnapshot(knowledgeBaseId, epoch);
  };

  /**
   * Confirm the visible tree after a remount, bounded like the persisted
   * snapshot: the root and the first expanded folders are refreshed in place.
   * Open folders past the cap are collapsed and forgotten instead of left stale,
   * so a long session with hundreds of open folders does not fire one request
   * per folder on every return; expanding one again loads it fresh.
   */
  #revalidateOnRemount = () => {
    const visible = this.#loadedVisibleFolders();
    const kept = new Set(visible.slice(0, MAX_PERSISTED_FOLDERS));
    // Everything else loaded is dropped: open folders past the cap, and folders
    // loaded earlier but collapsed (or under a collapsed parent). Their rows
    // would not be refreshed here, and expanding a folder that still has rows
    // skips the fetch, so they would stay stale for the rest of the session.
    const dropped = Object.keys(this.#get().children).filter((id) => !kept.has(id));
    if (dropped.length > 0) {
      const children = { ...this.#get().children };
      const expanded = { ...this.#get().expanded };
      for (const folderId of dropped) {
        delete children[folderId];
        if (expanded[folderId]) expanded[folderId] = false;
      }
      this.#set({ children, expanded }, false, 'tree/dropUnrefreshed');
    }

    for (const folderId of visible.slice(0, MAX_PERSISTED_FOLDERS)) {
      void this.#revalidateFolder(folderId);
    }
  };

  /** The root plus every expanded folder reachable from it that has rows loaded. */
  #loadedVisibleFolders = (): string[] => {
    const { children, expanded } = this.#get();
    const result: string[] = [];
    const queue = [''];
    while (queue.length > 0) {
      const folderId = queue.shift()!;
      const items = children[folderId];
      if (!items || result.includes(folderId)) continue;
      result.push(folderId);
      for (const item of items) if (item.isFolder && expanded[item.id]) queue.push(item.id);
    }
    return result;
  };

  /**
   * Forget the open library's persisted tree after a deletion only the server
   * can enumerate (delete-by-query): a reload must not repaint the deleted rows
   * if the follow-up refresh never lands. That refresh stores the survivors.
   */
  forgetSnapshot = () => {
    const { knowledgeBaseId } = this.#get();
    if (knowledgeBaseId) void this.#snapshot.remove(knowledgeBaseId);
  };

  /** A deleted library: drop its persisted tree, and the rendered one if it is open. */
  forgetLibrary = (knowledgeBaseId: string) => {
    void this.#snapshot.remove(knowledgeBaseId);
    if (this.#get().knowledgeBaseId === knowledgeBaseId) this.reset();
  };

  reset = () => {
    this.#queuedRevalidate.clear();
    this.#unconfirmedFolders.clear();
    this.#pendingTx.clear();
    this.#set(
      {
        children: {},
        epoch: this.#get().epoch + 1,
        errors: {},
        expanded: {},
        knowledgeBaseId: null,
        status: {},
      },
      false,
      'tree/reset',
    );
  };

  toggle = (folderId: string) => {
    const { expanded } = this.#get();
    const isExpanded = expanded[folderId];
    this.#set({ expanded: { ...expanded, [folderId]: !isExpanded } }, false, 'tree/toggle');

    if (!isExpanded && !this.#get().children[folderId]) {
      void this.loadChildren(folderId);
      return;
    }
    this.#persistSnapshot();
  };

  loadChildren = async (folderId: string) => {
    const { epoch, knowledgeBaseId, status } = this.#get();
    if (status[folderId] === 'loading') return;

    // Clear any prior error for this folder so a retry doesn't keep the failure marker.
    const nextErrors = { ...this.#get().errors };
    delete nextErrors[folderId];
    this.#set(
      { errors: nextErrors, status: { ...this.#get().status, [folderId]: 'loading' } },
      false,
      'tree/loadChildren/start',
    );

    try {
      const response = await fileService.getKnowledgeItems({
        includeContentPreview: false,
        knowledgeBaseId: knowledgeBaseId ?? undefined,
        parentId: folderId || null,
        showFilesInKnowledgeBase: false,
      });

      if (this.#get().epoch !== epoch) return;

      this.#set(
        {
          children: {
            ...this.#get().children,
            [folderId]: sortTreeItems(response.items.map(toTreeItem)),
          },
          status: { ...this.#get().status, [folderId]: 'idle' },
        },
        false,
        'tree/loadChildren/success',
      );
      this.#unconfirmedFolders.delete(folderId);
      this.#persistSnapshot();
      this.#runQueuedRevalidate(folderId);
    } catch (error) {
      if (this.#get().epoch !== epoch) return;
      console.error(`Failed to load children for ${folderId}:`, error);
      // Mark the folder as errored (was swallowed to 'idle', which read as a false
      // "empty folder" — Read §1.1 failure-as-empty). Keep the error so the view can
      // render a failure state with Retry instead of the "add folder" empty.
      this.#set(
        {
          errors: { ...this.#get().errors, [folderId]: error },
          status: { ...this.#get().status, [folderId]: 'error' },
        },
        false,
        'tree/loadChildren/error',
      );
      this.#runQueuedRevalidate(folderId);
    }
  };

  revalidate = async (folderKey: string) => {
    void revalidateHierarchySearch();
    await this.#revalidateFolder(this.#resolveFolderKey(folderKey));
  };

  /**
   * Refetch every loaded folder, for a mutation whose scope only the server
   * knows: a library-wide search reaches rows in folders the sidebar has
   * expanded, so refreshing the folder behind the explorer leaves the other
   * cached folders painting the deleted rows — and the snapshot written after
   * that single refresh would persist them too. `fallbackKey` keeps the
   * explorer's own folder in the batch when the sidebar never loaded it (a
   * deep link before its ancestors arrive).
   */
  revalidateLoaded = async (fallbackKey = ''): Promise<void> => {
    void revalidateHierarchySearch();
    const targets = new Set(this.#loadedVisibleFolders());
    targets.add(this.#resolveFolderKey(fallbackKey));

    this.#pendingBatch += 1;
    try {
      const refreshed = await Promise.all(
        [...targets].map((folderId) => this.#revalidateFolder(folderId)),
      );
      // A folder that failed (or was deferred behind an in-flight load) still
      // shows its pre-deletion rows: keep it out of the snapshot until a later
      // refresh confirms it, or a reload would repaint the deleted rows.
      [...targets].forEach((folderId, index) => {
        if (!refreshed[index]) this.#unconfirmedFolders.add(folderId);
      });
    } finally {
      this.#pendingBatch -= 1;
      this.#persistSnapshot();
    }
  };

  /**
   * Refetch one folder while its current rows stay on screen. A failure keeps
   * them (status back to idle) rather than flagging the folder as errored.
   * Resolves `true` only when the folder's rows now come from this refetch.
   */
  #revalidateFolder = async (folderId: string): Promise<boolean> => {
    const { epoch, knowledgeBaseId, status } = this.#get();
    if (status[folderId] === 'loading' || status[folderId] === 'revalidating') {
      this.#queuedRevalidate.add(folderId);
      return false;
    }

    this.#set(
      { status: { ...this.#get().status, [folderId]: 'revalidating' } },
      false,
      'tree/revalidate/start',
    );

    try {
      const response = await fileService.getKnowledgeItems({
        includeContentPreview: false,
        knowledgeBaseId: knowledgeBaseId ?? undefined,
        parentId: folderId || null,
        showFilesInKnowledgeBase: false,
      });

      if (this.#get().epoch !== epoch) return false;

      this.#set(
        {
          children: {
            ...this.#get().children,
            [folderId]: sortTreeItems(response.items.map(toTreeItem)),
          },
          status: { ...this.#get().status, [folderId]: 'idle' },
        },
        false,
        'tree/revalidate/success',
      );
      this.#unconfirmedFolders.delete(folderId);
      this.#persistSnapshot();
      this.#runQueuedRevalidate(folderId);
      return true;
    } catch {
      if (this.#get().epoch !== epoch) return false;
      this.#set(
        { status: { ...this.#get().status, [folderId]: 'idle' } },
        false,
        'tree/revalidate/error',
      );
      this.#runQueuedRevalidate(folderId);
      return false;
    }
  };

  /**
   * `confirmed: false` — the explorer list still carries optimistic overlays
   * (a pending create, rename, move or delete): render the rows, but keep them
   * out of the persisted snapshot until the explorer settles.
   */
  reconcile = (folderKey: string, items: TreeItem[], options?: { confirmed?: boolean }) => {
    const folderId = this.#resolveFolderKey(folderKey);
    // The explorer list can hold a row just created for ANOTHER folder (a folder
    // row's "+" while a different folder is open): it cannot tell without the
    // open folder's id, but the row's own parentId can. Rows with no parentId
    // are the server's and are kept as they are.
    const scoped = items.filter(
      (item) => item.parentId == null || item.parentId === (folderId || null),
    );
    this.#set(
      {
        children: { ...this.#get().children, [folderId]: sortTreeItems(scoped) },
        status: { ...this.#get().status, [folderId]: 'idle' },
      },
      false,
      'tree/reconcile',
    );
    if (options?.confirmed === false) {
      this.#unconfirmedFolders.add(folderId);
      return;
    }
    this.#unconfirmedFolders.delete(folderId);
    this.#persistSnapshot();
  };

  expandAncestors = async (folderIds: string[]) => {
    if (!folderIds.length) return;
    const epoch = this.#get().epoch;

    const expanded = { ...this.#get().expanded };
    for (const id of folderIds) expanded[id] = true;
    this.#set({ expanded }, false, 'tree/expandAncestors');

    await Promise.all(
      folderIds.filter((id) => !this.#get().children[id]).map((id) => this.loadChildren(id)),
    );

    if (this.#get().epoch !== epoch) return;
  };

  /**
   * Refresh the touched folders from the server once every queued mutation has
   * settled, so a revalidation never overwrites another move's optimistic rows.
   *
   * Must run AFTER `tx.commit()` resolves, never inside `tx.onSuccess`: the
   * engine only marks a mutation done after its onSuccess returns, so a
   * `flush()` awaited there waits for itself. The transaction then never
   * settled, the sidebar never revalidated, and every later mutation touching
   * the same folders queued behind the stuck one without reaching the server.
   */
  #revalidateSettled = async (folderKeys: string[]) => {
    await this.#getEngine().flush();
    void Promise.all(folderKeys.map((key) => this.revalidate(key)));
  };

  /**
   * Forget rows another store has already deleted, then refresh what changed.
   *
   * The deleting caller (the explorer's optimistic `deleteResource`, the
   * multi-select bulk delete) owns the network call; the tree only has to catch
   * up. It cannot be told which folder to refresh by the explorer's current
   * query: the shared row menu also runs on sidebar rows, and clicking a folder
   * there navigates into it, so "delete the folder I just opened" would refresh
   * the deleted folder instead of the parent list the sidebar renders. So find
   * the rows where they actually live and refresh those parents; the fallback
   * only covers rows the sidebar never loaded.
   *
   * The local removal is synchronous so the sidebar drops the row in the same
   * tick as the explorer, instead of after a refetch round-trip.
   */
  dropNodes = async (itemIds: string[], fallbackParentKey = ''): Promise<void> => {
    const ids = new Set(itemIds);
    if (ids.size === 0) return;

    const children = { ...this.#get().children };
    const expanded = { ...this.#get().expanded };
    const status = { ...this.#get().status };
    const errors = { ...this.#get().errors };
    const affectedParents: string[] = [];

    for (const [parentKey, items] of Object.entries(children)) {
      if (!items.some((item) => ids.has(item.id))) continue;
      affectedParents.push(parentKey);
      children[parentKey] = items.filter((item) => !ids.has(item.id));
    }

    // Drop the removed folders' own caches too, descendants included: a stale
    // `children[id]` would otherwise survive as an orphan and be served as the
    // folder's contents if that key ever came back.
    const pending = [...ids];
    while (pending.length > 0) {
      const id = pending.pop()!;
      const descendants = children[id];
      if (descendants) pending.push(...descendants.filter((i) => i.isFolder).map((i) => i.id));
      delete children[id];
      delete expanded[id];
      delete status[id];
      delete errors[id];
      this.#unconfirmedFolders.delete(id);
    }

    this.#set({ children, errors, expanded, status }, false, 'tree/dropNodes');
    this.#persistSnapshot();

    // A parent that is itself being removed has no list left to refresh, and
    // fetching it would recreate the orphan entry the purge just dropped.
    const targets = affectedParents.filter((key) => !ids.has(key));
    await this.#revalidateSettled(targets.length > 0 ? targets : [fallbackParentKey]);
  };

  moveItem = async (itemId: string, fromParent: string, toParent: string): Promise<void> => {
    const { children } = this.#get();
    const item = children[fromParent]?.find((i) => i.id === itemId);

    if (!item) {
      const { useFileStore } = await import('@/store/file');
      const { resourceMap } = useFileStore.getState();

      if (resourceMap.has(itemId)) {
        await useFileStore.getState().moveResource(itemId, toParent || null);
      } else {
        const cachePatch = await useFileStore
          .getState()
          .prepareResourceMoveCachePatch(fromParent || null, toParent || null);
        const moved = await resourceService.moveResource(itemId, toParent || null);
        await useFileStore.getState().applyMovedResourceToCaches(moved, cachePatch);
        await useFileStore.getState().refreshFileList();
      }

      void Promise.all([this.revalidate(fromParent), this.revalidate(toParent)]);
      return;
    }

    const engine = this.#getEngine();
    const tx = engine.createTransaction(`moveItem(${itemId})`);

    tx.set((draft) => {
      draft.children[fromParent] = (draft.children[fromParent] ?? []).filter(
        (i) => i.id !== itemId,
      );
      // Only a loaded destination gets the row. Seeding an unloaded folder with
      // just the moved item would make its first expand skip the fetch and show
      // that lone row as the whole folder; the post-commit revalidate fills it.
      const target = draft.children[toParent];
      if (target) {
        draft.children[toParent] = sortTreeItems([...target.filter((i) => i.id !== itemId), item]);
      }
    });

    tx.mutation = async () => {
      const { useFileStore } = await import('@/store/file');
      const { resourceMap } = useFileStore.getState();

      if (resourceMap.has(itemId)) {
        // Item visible in Explorer → delegate (handles optimistic Explorer update + API)
        await useFileStore.getState().moveResource(itemId, toParent || null);
      } else {
        // Item not in Explorer → API only, then patch the folder-list caches
        // (the explorer's SWR entries for both folders) and refresh Explorer
        const cachePatch = await useFileStore
          .getState()
          .prepareResourceMoveCachePatch(fromParent || null, toParent || null);
        const moved = await resourceService.moveResource(itemId, toParent || null);
        await useFileStore.getState().applyMovedResourceToCaches(moved, cachePatch);
        await useFileStore.getState().refreshFileList();
      }
    };

    if (await this.#commitTracked(tx)) await this.#revalidateSettled([fromParent, toParent]);
  };

  moveItems = async (itemIds: string[], fromParent: string, toParent: string): Promise<void> => {
    const { children } = this.#get();
    const idsSet = new Set(itemIds);
    const items = (children[fromParent] ?? []).filter((i) => idsSet.has(i.id));
    if (items.length === 0) return;

    const engine = this.#getEngine();
    const tx = engine.createTransaction(`moveItems(${itemIds.join(',')})`);

    tx.set((draft) => {
      draft.children[fromParent] = (draft.children[fromParent] ?? []).filter(
        (i) => !idsSet.has(i.id),
      );
      const target = draft.children[toParent];
      if (target) {
        draft.children[toParent] = sortTreeItems([
          ...target.filter((i) => !idsSet.has(i.id)),
          ...items,
        ]);
      }
    });

    tx.mutation = async () => {
      const { useFileStore } = await import('@/store/file');
      const { resourceMap } = useFileStore.getState();

      // Split items into those visible in Explorer vs not
      const inExplorer = itemIds.filter((id) => resourceMap.has(id));
      const notInExplorer = itemIds.filter((id) => !resourceMap.has(id));

      const promises: Promise<unknown>[] = [];

      // Items in Explorer → delegate to file store (optimistic update + API)
      for (const id of inExplorer) {
        promises.push(useFileStore.getState().moveResource(id, toParent || null));
      }

      // Items not in Explorer → API only, then patch the folder-list caches
      const cachePatch =
        notInExplorer.length > 0
          ? await useFileStore
              .getState()
              .prepareResourceMoveCachePatch(fromParent || null, toParent || null)
          : undefined;
      for (const id of notInExplorer) {
        promises.push(
          resourceService
            .moveResource(id, toParent || null)
            .then((moved) =>
              useFileStore.getState().applyMovedResourceToCaches(moved, cachePatch!),
            ),
        );
      }

      await Promise.all(promises);

      if (notInExplorer.length > 0) {
        await useFileStore.getState().refreshFileList();
      }
    };

    if (await this.#commitTracked(tx)) await this.#revalidateSettled([fromParent, toParent]);
  };

  renameItem = async (itemId: string, parentId: string, newName: string): Promise<void> => {
    const engine = this.#getEngine();
    const tx = engine.createTransaction(`renameItem(${itemId})`);

    tx.set((draft) => {
      const list = draft.children[parentId];
      if (!list) return;
      const idx = list.findIndex((i) => i.id === itemId);
      if (idx !== -1) list[idx] = { ...list[idx], name: newName };
    });

    tx.mutation = async () => {
      await resourceService.updateResource(itemId, { name: newName });
      // The search surfaces keep their own persisted copies of the hit.
      const { useResourceManagerStore } = await import('@/features/ResourceManager/store');
      useResourceManagerStore.getState().patchSearchHit(itemId, { name: newName });
      const { useFileStore } = await import('@/store/file');
      await useFileStore.getState().refreshFileList();
    };

    if (await this.#commitTracked(tx)) await this.#revalidateSettled([parentId]);
  };

  removeItems = async (itemIds: string[], parentId: string): Promise<void> => {
    const idsSet = new Set(itemIds);
    const engine = this.#getEngine();
    const tx = engine.createTransaction(`removeItems(${itemIds.join(',')})`);

    tx.set((draft) => {
      draft.children[parentId] = (draft.children[parentId] ?? []).filter((i) => !idsSet.has(i.id));
    });

    tx.mutation = async () => {
      await resourceService.deleteResources(itemIds);
      const { useFileStore } = await import('@/store/file');
      await useFileStore.getState().refreshFileList();
    };

    if (await this.#commitTracked(tx)) await this.dropNodes(itemIds, parentId);
  };
}
