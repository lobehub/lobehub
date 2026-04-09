import { fileService } from '@/services/file';
import { resourceService } from '@/services/resource';
import type { StoreSetter } from '@/store/types';
import { OptimisticEngine } from '@/store/utils/optimisticEngine';

import type { TreeDataState, TreeItem, TreeState, TreeStoreHandle } from './types';

export const sortTreeItems = <T extends TreeItem>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;
    return a.name.localeCompare(b.name);
  });
};

export const toTreeItem = (item: {
  fileType: string;
  id: string;
  metadata?: Record<string, any> | null;
  name: string;
  slug?: string | null;
  sourceType?: string;
  url?: string;
}): TreeItem => ({
  fileType: item.fileType,
  id: item.id,
  isFolder: item.fileType === 'custom/folder',
  metadata: item.metadata ?? undefined,
  name: item.name,
  slug: item.slug,
  sourceType: item.sourceType,
  url: item.url ?? '',
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

  init = (knowledgeBaseId: string) => {
    this.#set(
      {
        children: {},
        epoch: this.#get().epoch + 1,
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
    this.#set(
      {
        children: {},
        epoch: this.#get().epoch + 1,
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

    this.#set(
      { status: { ...this.#get().status, [folderId]: 'loading' } },
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
    } catch (error) {
      if (this.#get().epoch !== epoch) return;
      console.error(`Failed to load children for ${folderId}:`, error);
      this.#set(
        { status: { ...this.#get().status, [folderId]: 'idle' } },
        false,
        'tree/loadChildren/error',
      );
    }
  };

  revalidate = async (folderId: string) => {
    const { epoch, knowledgeBaseId, status } = this.#get();
    if (status[folderId] === 'loading') return;

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
    } catch {
      if (this.#get().epoch !== epoch) return;
      this.#set(
        { status: { ...this.#get().status, [folderId]: 'idle' } },
        false,
        'tree/revalidate/error',
      );
    }
  };

  reconcile = (folderId: string, items: TreeItem[]) => {
    this.#set(
      {
        children: { ...this.#get().children, [folderId]: sortTreeItems(items) },
        status: { ...this.#get().status, [folderId]: 'idle' },
      },
      false,
      'tree/reconcile',
    );
  };

  navigateTo = async (folderSlug: string) => {
    const epoch = this.#get().epoch;
    const breadcrumb = await fileService.getFolderBreadcrumb(folderSlug);
    if (!breadcrumb?.length || this.#get().epoch !== epoch) return;

    const folderIds = breadcrumb.map((c: { id: string }) => c.id);
    const expanded = { ...this.#get().expanded };
    for (const id of folderIds) expanded[id] = true;
    this.#set({ expanded }, false, 'tree/navigateTo/expand');

    await Promise.all(
      folderIds
        .filter((id: string) => !this.#get().children[id])
        .map((id: string) => this.loadChildren(id)),
    );
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
      draft.children[toParent] = sortTreeItems([...(draft.children[toParent] ?? []), item]);
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

    tx.onSuccess = async () => {
      await engine.flush();
      void Promise.all([this.revalidate(fromParent), this.revalidate(toParent)]);
    };

    await tx.commit();
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
      draft.children[toParent] = sortTreeItems([...(draft.children[toParent] ?? []), ...items]);
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

    tx.onSuccess = async () => {
      await engine.flush();
      void Promise.all([this.revalidate(fromParent), this.revalidate(toParent)]);
    };

    await tx.commit();
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

    tx.onSuccess = async () => {
      await engine.flush();
      void this.revalidate(parentId);
    };

    await tx.commit();
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

    tx.onSuccess = async () => {
      await engine.flush();
      const expanded = { ...this.#get().expanded };
      const children = { ...this.#get().children };
      for (const id of itemIds) {
        delete expanded[id];
        delete children[id];
      }
      this.#set({ children, expanded }, false, 'tree/removeItems/cleanup');
      void this.revalidate(parentId);
    };

    await tx.commit();
  };
}
