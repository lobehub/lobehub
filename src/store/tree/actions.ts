import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { mutate } from 'swr';

import { resourceKeys } from '@/libs/swr/keys';
import { fileService } from '@/services/file';
import { resourceService } from '@/services/resource';
import type { StoreSetter } from '@/store/types';
import { OptimisticEngine } from '@/store/utils/optimisticEngine';

import type { TreeDataState, TreeItem, TreeState, TreeStoreHandle } from './types';

/**
 * The library sidebar swaps the tree for a flat search list while a query is
 * typed; its rows reuse the tree's rename/move/delete actions. Those actions
 * only know the affected folder, so every tree revalidation also refreshes the
 * hierarchy-scoped search caches or a renamed/deleted hit would linger there.
 */
export const revalidateHierarchySearch = () =>
  mutate(
    (key) =>
      Array.isArray(key) &&
      key[0] === resourceKeys.search.root &&
      (key[1] as { scope?: string } | undefined)?.scope === 'hierarchy',
    async (currentData) => currentData,
    { revalidate: true },
  );

export const sortTreeItems = <T extends TreeItem>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;
    return a.name.localeCompare(b.name);
  });
};

export const toTreeItem = (item: {
  fileId?: string | null;
  fileType: string;
  id: string;
  metadata?: Record<string, any> | null;
  name: string;
  parentId?: string | null;
  size?: number | null;
  slug?: string | null;
  sourceType?: string;
  url?: string;
  userId?: string | null;
  visibility?: 'private' | 'public' | null;
}): TreeItem => ({
  fileId: item.fileId,
  fileType: item.fileType,
  id: item.id,
  isFolder: item.fileType === CUSTOM_FOLDER_FILE_TYPE,
  metadata: item.metadata ?? undefined,
  name: item.name,
  parentId: item.parentId,
  size: item.size ?? undefined,
  slug: item.slug,
  sourceType: item.sourceType,
  url: item.url ?? '',
  userId: item.userId,
  visibility: item.visibility,
});

type Setter = StoreSetter<TreeState>;

export class TreeActionImpl {
  readonly #get: () => TreeState;
  readonly #set: Setter;
  #engine?: OptimisticEngine<TreeDataState>;
  #storeHandle: TreeStoreHandle;

  constructor(set: Setter, get: () => TreeState) {
    this.#set = set;
    this.#get = get;
    this.#storeHandle = {
      getState: () => ({
        children: get().children,
        status: get().status,
      }),
      setState: (next) => set(next as Partial<TreeState>, false, 'tree/engineSetState'),
    };
  }

  #getEngine = () => {
    if (this.#engine) return this.#engine;
    this.#engine = new OptimisticEngine(this.#storeHandle, { maxRetries: 1 });
    return this.#engine;
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

  init = (knowledgeBaseId: string) => {
    this.#queuedRevalidate.clear();
    this.#set(
      {
        children: {},
        epoch: this.#get().epoch + 1,
        errors: {},
        expanded: {},
        knowledgeBaseId,
        status: {},
      },
      false,
      'tree/init',
    );
    void this.loadChildren('');
  };

  reset = () => {
    this.#queuedRevalidate.clear();
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
    }
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

    const folderId = this.#resolveFolderKey(folderKey);
    const { epoch, knowledgeBaseId, status } = this.#get();
    if (status[folderId] === 'loading' || status[folderId] === 'revalidating') {
      this.#queuedRevalidate.add(folderId);
      return;
    }

    this.#set(
      { status: { ...this.#get().status, [folderId]: 'revalidating' } },
      false,
      'tree/revalidate/start',
    );

    try {
      const response = await fileService.getKnowledgeItems({
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
        'tree/revalidate/success',
      );
      this.#runQueuedRevalidate(folderId);
    } catch {
      if (this.#get().epoch !== epoch) return;
      this.#set(
        { status: { ...this.#get().status, [folderId]: 'idle' } },
        false,
        'tree/revalidate/error',
      );
      this.#runQueuedRevalidate(folderId);
    }
  };

  reconcile = (folderKey: string, items: TreeItem[]) => {
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

  moveItem = async (itemId: string, fromParent: string, toParent: string): Promise<void> => {
    const { children } = this.#get();
    const item = children[fromParent]?.find((i) => i.id === itemId);

    if (!item) {
      const { useFileStore } = await import('@/store/file');
      const { resourceMap } = useFileStore.getState();

      if (resourceMap.has(itemId)) {
        await useFileStore.getState().moveResource(itemId, toParent || null);
      } else {
        await resourceService.moveResource(itemId, toParent || null);
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
        // Item not in Explorer → API only, then refresh Explorer
        await resourceService.moveResource(itemId, toParent || null);
        await useFileStore.getState().refreshFileList();
      }
    };

    await tx.commit();
    await this.#revalidateSettled([fromParent, toParent]);
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

      // Items not in Explorer → API only
      for (const id of notInExplorer) {
        promises.push(resourceService.moveResource(id, toParent || null));
      }

      await Promise.all(promises);

      if (notInExplorer.length > 0) {
        await useFileStore.getState().refreshFileList();
      }
    };

    await tx.commit();
    await this.#revalidateSettled([fromParent, toParent]);
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
      const { useFileStore } = await import('@/store/file');
      await useFileStore.getState().refreshFileList();
    };

    await tx.commit();
    await this.#revalidateSettled([parentId]);
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

    await tx.commit();

    const expanded = { ...this.#get().expanded };
    const children = { ...this.#get().children };
    for (const id of itemIds) {
      delete expanded[id];
      delete children[id];
    }
    this.#set({ children, expanded }, false, 'tree/removeItems/cleanup');
    await this.#revalidateSettled([parentId]);
  };
}
