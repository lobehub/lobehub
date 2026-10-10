import { useLayoutEffect } from 'react';
import type { StateCreator } from 'zustand/vanilla';

import type { ResourceManagerMode } from '@/features/ResourceManager';
import {
  createReplicaSlice,
  readReplicaStoredKeys,
  recordLens,
  type ReplicaPageResult,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { useFileStore } from '@/store/file';
import type { StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';
import type { FilesTabs, ResourceSourceFilter, SortType } from '@/types/files';
import type { ResourceItem } from '@/types/resource';
import { setNamespace } from '@/utils/storeDebug';

import type { ResourceListVisibilityFilter, SelectAllState, State, ViewMode } from './initialState';
import { DEFAULT_WORKSPACE_LIST_VISIBILITY, initialState } from './initialState';
import { readPersistedResourceMode, writePersistedResourceMode } from './modePersistence';
import {
  DEFAULT_SEARCH_PAGE_SIZE,
  type ExplorerSearchParams,
  explorerSearchResource,
  type ExplorerSearchValue,
  type HierarchySearchParams,
  hierarchySearchResource,
  type HierarchySearchValue,
} from './projection';

const n = setNamespace('resourceManager');

export type MultiSelectActionType =
  | 'addToKnowledgeBase'
  | 'moveToOtherKnowledgeBase'
  | 'batchChunking'
  | 'delete'
  | 'deleteLibrary'
  | 'removeFromKnowledgeBase';

export interface FolderCrumb {
  id: string;
  name: string;
  slug: string;
}

export type Store = Action & State;

type Setter = StoreSetter<Store>;

/**
 * One page of a search list. `cursor` is the page index (0 = head), so the
 * replica owns the offset and a query change repaints from its own head page.
 */
const fetchExplorerSearchPage = async (
  params: ExplorerSearchParams,
  cursor?: number,
): Promise<ReplicaPageResult<ResourceItem, number>> => {
  const { resourceService } = await import('@/services/resource');
  const pageSize = params.pageSize ?? DEFAULT_SEARCH_PAGE_SIZE;

  const response = await resourceService.queryResources({
    category: params.category,
    includeContentPreview: params.includeContentPreview,
    libraryId: params.libraryId,
    limit: pageSize,
    offset: (cursor ?? 0) * pageSize,
    q: params.q,
    showFilesInKnowledgeBase: false,
    sourceFilter: params.sourceFilter,
    visibility: params.visibility,
  });

  return { items: response.items, total: response.total };
};

const fetchHierarchySearchPage = async (
  params: HierarchySearchParams,
  cursor?: number,
): Promise<ReplicaPageResult<ResourceItem, number>> => {
  const { resourceService } = await import('@/services/resource');
  const pageSize = params.pageSize ?? DEFAULT_SEARCH_PAGE_SIZE;

  const response = await resourceService.queryResources({
    libraryId: params.libraryId,
    limit: pageSize,
    offset: (cursor ?? 0) * pageSize,
    q: params.q,
    showFilesInKnowledgeBase: false,
  });

  return { items: response.items, total: response.total };
};

/**
 * How many distinct queries per search surface keep a replica entry. The one
 * the user is on is always the most recent, so bounding the list bounds memory
 * and IndexedDB together: searching all day cannot grow either without limit,
 * and the queries just used still paint from their own rows when revisited.
 */
export const MAX_RECENT_SEARCHES = 8;

/** Where the explorer search views live in the store — one entry per query. */
const explorerSearchLens = recordLens<Store, ExplorerSearchValue>('explorerSearchEntries');

/** Where the library sidebar search views live — one entry per (library, keyword). */
const hierarchySearchLens = recordLens<Store, HierarchySearchValue>('hierarchySearchEntries');

/**
 * Either search surface. Both key their persisted rows by the entry key alone
 * (neither sets a replica `query`), so the stored index holds entry keys.
 */
type SearchReplicaResource = typeof explorerSearchResource | typeof hierarchySearchResource;

export class ResourceManagerStoreActionImpl {
  readonly #get: () => Store;
  readonly #set: Setter;
  readonly #explorerSearch;
  readonly #hierarchySearch;
  /** Query entry keys each surface has used, oldest first (see `#trackRecentSearch`). */
  readonly #recentExplorerSearches: string[] = [];
  readonly #recentHierarchySearches: string[] = [];
  /** Identity each recency list currently belongs to (see `#seedRecentSearches`). */
  readonly #recentSearchScope = new WeakMap<string[], string>();
  /** Recency lists whose persisted keys are already folded in. */
  readonly #seededRecentSearches = new WeakSet<string[]>();
  /**
   * The sidebar search entry on screen, if any. The sync driver revalidates
   * only mounted queries, so this is the one entry whose head a refresh can
   * repair (see `collapseHierarchySearch`).
   */
  #activeHierarchySearchKey?: string;

  constructor(set: Setter, get: () => Store, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;

    this.#explorerSearch = createReplicaSlice(explorerSearchResource, {
      actionPrefix: n('explorerSearch'),
      fetcher: fetchExplorerSearchPage,
      get,
      set,
      stateKey: 'explorerSearchReplica',
      view: explorerSearchLens,
      // The keyword is part of the entry identity, so the mounted surface can
      // tell whether the painted rows still answer the request on screen.
      viewFields: (params) => ({ searchParams: params }),
    });

    this.#hierarchySearch = createReplicaSlice(hierarchySearchResource, {
      actionPrefix: n('hierarchySearch'),
      fetcher: fetchHierarchySearchPage,
      get,
      set,
      stateKey: 'hierarchySearchReplica',
      view: hierarchySearchLens,
      viewFields: (params) => ({ searchParams: params }),
    });
  }

  /**
   * Fold the keys an earlier session persisted into a surface's recency list,
   * once per list per scope.
   *
   * {@link MAX_RECENT_SEARCHES} only bounds what the list knows about, and a
   * list that starts empty on every page load bounds nothing across reloads:
   * each session would persist up to the cap again while the rows of every
   * session before it stayed in IndexedDB. Seeding the list from the persisted
   * index makes the window — and with it what eviction drops — span sessions.
   */
  #seedRecentSearches = (
    recents: string[],
    resource: SearchReplicaResource,
    drop: (key: string) => void,
  ): void => {
    const scope = resource.scope.get();
    if (this.#recentSearchScope.get(recents) !== scope) {
      // Another identity owns the partition: the keys this list learned stood
      // for the previous scope's rows, so start the window over for this one.
      recents.length = 0;
      this.#recentSearchScope.set(recents, scope);
      this.#seededRecentSearches.delete(recents);
    }
    if (this.#seededRecentSearches.has(recents)) return;
    this.#seededRecentSearches.add(recents);

    void readReplicaStoredKeys(resource).then((persisted) => {
      // A scope switch while the index was read voids this seed.
      if (this.#recentSearchScope.get(recents) !== scope) return;
      // The index is append-ordered (oldest first); prepending keeps that order,
      // so eviction — which takes from the front — drops the least recently used
      // persisted query first.
      for (const persistedKey of [...persisted].reverse()) {
        if (!recents.includes(persistedKey)) recents.unshift(persistedKey);
      }
      this.#evictOldestSearches(recents, drop);
    });
  };

  #evictOldestSearches = (recents: string[], drop: (key: string) => void): void => {
    while (recents.length > MAX_RECENT_SEARCHES) {
      const oldest = recents.shift();
      if (oldest) drop(oldest);
    }
  };

  /**
   * Remember a query the user is looking at, and drop the oldest ones past
   * {@link MAX_RECENT_SEARCHES}. Dropping removes the replica entry (memory)
   * *and* its persisted projection, so both stay bounded no matter how many
   * keywords are tried. Called from a layout effect, never during render.
   */
  #trackRecentSearch = (
    recents: string[],
    key: string,
    drop: (key: string) => void,
    resource: SearchReplicaResource,
  ): void => {
    this.#seedRecentSearches(recents, resource, drop);
    const existing = recents.indexOf(key);
    if (existing !== -1) recents.splice(existing, 1);
    recents.push(key);
    this.#evictOldestSearches(recents, drop);
  };

  /**
   * Invalidate every cached sidebar search.
   *
   * A rename / move / delete in the tree can touch a row the sidebar search
   * loaded beyond its head page. Revalidating only re-runs the head request and
   * the replica keeps the rows the user already scrolled to, so a stale hit
   * would linger in that tail; dropping the loaded pages first means the head
   * that comes back is the only thing left to show.
   *
   * Only the entry on screen gets that treatment. The driver revalidates just
   * mounted queries, so every other entry — a search left behind in memory, or
   * one only an earlier session had persisted — would keep its stale head
   * forever (and offline, indefinitely). Those are dropped outright: a revisit
   * then has nothing stale to hydrate.
   */
  collapseHierarchySearch = async (): Promise<void> => {
    const loaded = new Set(Object.keys(this.#get().hierarchySearchEntries));
    const active = this.#activeHierarchySearchKey;
    for (const key of loaded) {
      if (key === active) this.#hierarchySearch.collapse(key);
      else this.#hierarchySearch.remove(key);
    }

    const scope = hierarchySearchResource.scope.get();
    const persisted = await readReplicaStoredKeys(hierarchySearchResource);
    // The identity can change while the index is read; those rows are not ours
    // to touch, and `remove` resolves against the *current* scope.
    if (hierarchySearchResource.scope.get() !== scope) return;
    for (const key of persisted) {
      if (!loaded.has(key)) this.#hierarchySearch.remove(key);
    }
  };

  clearSelectAllState = (): void => {
    this.#set({ selectAllState: 'none', selectedFileIds: [], selectionTotal: undefined });
  };

  handleBackToList = (): void => {
    this.#set({ currentViewItemId: undefined, mode: 'explorer' });
  };

  onActionClick = async (type: MultiSelectActionType): Promise<void> => {
    const { libraryId, resolveSelectedResourceIds, selectAllState, selectedFileIds } = this.#get();
    const { useFileStore } = await import('@/store/file');
    const { useKnowledgeBaseStore } = await import('@/store/library');
    const { isChunkingSupported } = await import('@/libs/document-loaders/loaderType');

    const fileStore = useFileStore.getState();
    const kbStore = useKnowledgeBaseStore.getState();

    switch (type) {
      case 'delete': {
        // The explorer's own list is optimistic, but the sidebar tree keeps a
        // separate per-folder cache: without this it holds deleted folders
        // until the next full load.
        const { useTreeStore } = await import('@/store/tree');
        const currentFolderKey = fileStore.queryParams?.parentId ?? '';

        if (selectAllState === 'all' && fileStore.queryParams) {
          const { resourceService } = await import('@/services/resource');

          await resourceService.deleteResourcesByQuery(
            fileStore.queryParams as any,
            selectedFileIds,
          );
          fileStore.clearCurrentQueryResources();
          // The server applies the caller's workspace role: members delete
          // only their own rows, while owners may delete the full query scope.
          // Revalidate so any surviving rows immediately reappear.
          const { revalidateResources } = await import('@/store/file/slices/resource/hooks');
          await revalidateResources(fileStore.queryParams);
          // The deleted set is only known to the server here, and every row in
          // it was a child of the listed folder, so refetch that one folder.
          void useTreeStore.getState().revalidate(currentFolderKey);

          this.clearSelectAllState();
          return;
        }

        const resourceIds =
          selectAllState === 'all' ? await resolveSelectedResourceIds() : selectedFileIds;

        await fileStore.deleteResources(resourceIds);
        void useTreeStore.getState().dropNodes(resourceIds, currentFolderKey);

        this.clearSelectAllState();
        return;
      }

      case 'removeFromKnowledgeBase': {
        const resourceIds = await resolveSelectedResourceIds();
        if (!libraryId) return;

        await kbStore.removeFilesFromKnowledgeBase(libraryId, resourceIds);
        this.clearSelectAllState();
        return;
      }

      case 'addToKnowledgeBase':
      case 'moveToOtherKnowledgeBase': {
        return;
      }

      case 'batchChunking': {
        const resourceIds = await resolveSelectedResourceIds();
        const chunkableFileIds = resourceIds.filter((id) => {
          const resource = fileStore.resourceMap?.get(id);
          // For server-resolved IDs not yet in the local map, include them
          // and let the server handle unsupported type filtering
          if (!resource) return selectAllState === 'all';
          return isChunkingSupported(resource);
        });

        await fileStore.parseFilesToChunks(chunkableFileIds, { skipExist: true });
        this.clearSelectAllState();
        return;
      }

      case 'deleteLibrary': {
        if (!libraryId) return;

        await kbStore.removeKnowledgeBase(libraryId);

        if (typeof window !== 'undefined') {
          window.location.href = '/knowledge';
        }
      }
    }
  };

  resolveSelectedResourceIds = async (): Promise<string[]> => {
    const { selectAllState, selectedFileIds } = this.#get();
    if (selectAllState !== 'all') return selectedFileIds;

    const { resourceService } = await import('@/services/resource');
    const { useFileStore } = await import('@/store/file');
    const queryParams = useFileStore.getState().queryParams;

    if (!queryParams) return selectedFileIds;

    const result = await resourceService.resolveSelectionIds(queryParams as any);
    return result.ids.filter((id) => !selectedFileIds.includes(id));
  };

  selectAllLoadedResources = (selectedFileIds: string[]): void => {
    this.#set({ selectedFileIds, selectAllState: 'loaded', selectionTotal: undefined });
  };

  selectAllResources = async (): Promise<void> => {
    const { resourceService } = await import('@/services/resource');
    const queryParams = useFileStore.getState().queryParams;

    if (!queryParams) return;

    const { total } = await resourceService.resolveSelectionIds(queryParams as any);
    this.#set({ selectAllState: 'all', selectedFileIds: [], selectionTotal: total });
  };

  setCategory = (category: FilesTabs): void => {
    // Drop any explicit source pick so the new category falls back to its own
    // default — an "AI generated" choice made under Images must not silently
    // hide every uploaded file under Documents.
    this.#set({ category, sourceFilter: undefined });
  };

  setSourceFilter = (sourceFilter: ResourceSourceFilter): void => {
    if (this.#get().sourceFilter === sourceFilter) return;

    // The visible pool changes, so a standing "select all" would target rows
    // that are no longer on screen — same reset as the visibility toggle.
    this.#set({
      selectAllState: 'none',
      selectedFileIds: [],
      selectionTotal: undefined,
      sourceFilter,
    });

    // Drop the previous source's rows immediately, exactly as the visibility
    // toggle does. Without this the old rows stay on screen and interactive
    // under the newly active chip until the fetch lands — and a "select all"
    // fired in that window resolves against `useFileStore.queryParams`, which
    // still carries the previous source, so the following batch action would
    // target rows the user is no longer looking at.
    useFileStore.getState().clearCurrentQueryResources();
  };

  setCurrentViewItemId = (currentViewItemId?: string): void => {
    this.#set({ currentViewItemId });
  };

  closeDetailPanel = (): void => {
    this.#set({ detailPanelId: undefined, detailPanelIsPage: false });
  };

  openDetailPanel = (detailPanelId: string, isPage = false): void => {
    this.#set({ detailPanelId, detailPanelIsPage: isPage });
  };

  setLibraryId = (libraryId?: string): void => {
    if (this.#get().libraryId === libraryId) return;
    // A sidebar search is scoped to one library; carrying it over to the next
    // library would show results the user never asked for.
    this.#set({ libraryId, librarySearchQuery: '' });
  };

  setLibrarySearchQuery = (librarySearchQuery: string): void => {
    this.#set({ librarySearchQuery });
  };

  setListVisibility = (
    listVisibility: ResourceListVisibilityFilter,
    workspaceId?: string,
  ): void => {
    // Skip the write path when the mode didn't actually change — clicking the
    // already-active tab shouldn't invalidate the list.
    if (this.#get().listVisibility === listVisibility) return;

    // Reset selection when the visible pool changes so a leftover "select all"
    // does not accidentally target rows that are no longer on screen.
    this.#set({
      listVisibility,
      selectAllState: 'none',
      selectedFileIds: [],
      selectionTotal: undefined,
    });

    // Drop the previous mode's rows from the file store immediately. Without
    // this, `mergeServerResourcesWithOptimistic` would keep showing them until
    // the SWR fetch for the new mode resolves — the "space switch" feels
    // broken because the list looks unchanged for a beat. Clearing gives the
    // Explorer a clean slate so its skeleton (see `isNavigating`) renders
    // right away and the new items slot in when they arrive.
    useFileStore.getState().clearCurrentQueryResources();

    // Persist per workspace so the next visit picks up the same space. Personal
    // mode (no workspaceId) intentionally skips the write — the toggle isn't
    // rendered there and there's no scope to key the record against.
    writePersistedResourceMode(workspaceId, listVisibility);
  };

  /**
   * Reload `listVisibility` from localStorage for the given workspace. Called
   * on Sidebar mount / whenever the active workspace changes so the "space"
   * you left off in comes back. Falls back to the workspace default when no
   * record exists; personal mode keeps the base initialState default because
   * the workspace toggle is hidden there.
   */
  hydrateListVisibility = (workspaceId: string | undefined): void => {
    const persisted = readPersistedResourceMode(workspaceId);
    const next =
      persisted ?? (workspaceId ? DEFAULT_WORKSPACE_LIST_VISIBILITY : initialState.listVisibility);
    if (this.#get().listVisibility === next) return;
    this.#set({
      listVisibility: next,
      selectAllState: 'none',
      selectedFileIds: [],
      selectionTotal: undefined,
    });
  };

  setMode = (mode: ResourceManagerMode): void => {
    this.#set({ mode });
  };

  setPendingRenameItemId = (pendingRenameItemId: string | null): void => {
    this.#set({ pendingRenameItemId });
  };

  setPendingTreeRenameItemId = (pendingTreeRenameItemId: string | null): void => {
    this.#set({ pendingTreeRenameItemId });
  };

  setSearchQuery = (searchQuery: string | null): void => {
    this.#set({ searchQuery });
  };

  setSelectAllState = (selectAllState: SelectAllState): void => {
    this.#set({
      selectAllState,
      selectionTotal: selectAllState === 'all' ? this.#get().selectionTotal : undefined,
    });
  };

  setSelectedFileIds = (selectedFileIds: string[]): void => {
    const { selectAllState } = this.#get();

    this.#set({
      selectAllState:
        selectedFileIds.length === 0 && selectAllState !== 'all' ? 'none' : selectAllState,
      selectedFileIds,
    });
  };

  setSorter = (sorter: 'name' | 'createdAt' | 'size'): void => {
    this.#set({ sorter });
  };

  setSortType = (sortType: SortType): void => {
    this.#set({ sortType });
  };

  setViewMode = (viewMode: ViewMode): void => {
    this.#set({ viewMode });
  };

  /**
   * Fetch orchestration for the explorer's search overlay. It only schedules the
   * sync; read the rows from `explorerSearchEntries[explorerSearchResource.key(params)]`.
   */
  useFetchExplorerSearch = (params: ExplorerSearchParams | null): ReplicaSyncResult => {
    const key = params ? explorerSearchResource.key(params) : undefined;
    useLayoutEffect(() => {
      if (key) {
        this.#trackRecentSearch(
          this.#recentExplorerSearches,
          key,
          (stale) => this.#explorerSearch.remove(stale),
          explorerSearchResource,
        );
      }
    }, [key]);
    return this.#explorerSearch.useSync(params);
  };

  /**
   * Fetch orchestration for the library sidebar's flat search list. It only
   * schedules the sync; read the rows from
   * `hierarchySearchEntries[hierarchySearchResource.key(params)]`.
   */
  useFetchHierarchySearch = (params: HierarchySearchParams | null): ReplicaSyncResult => {
    const key = params ? hierarchySearchResource.key(params) : undefined;
    useLayoutEffect(() => {
      if (key) {
        this.#trackRecentSearch(
          this.#recentHierarchySearches,
          key,
          (stale) => this.#hierarchySearch.remove(stale),
          hierarchySearchResource,
        );
      }
    }, [key]);
    // The driver revalidates only mounted queries, so remember which entry the
    // sidebar is showing: `collapseHierarchySearch` collapses that one's head
    // (the refetch repairs it) and drops the heads of the rest.
    useLayoutEffect(() => {
      if (!key) return;
      this.#activeHierarchySearchKey = key;
      return () => {
        if (this.#activeHierarchySearchKey === key) this.#activeHierarchySearchKey = undefined;
      };
    }, [key]);
    return this.#hierarchySearch.useSync(params);
  };

  /** Append the next page of the explorer search (the entry's own query). */
  loadMoreExplorerSearch = async (key: string): Promise<void> => this.#explorerSearch.loadMore(key);

  /** Append the next page of the sidebar search (the entry's own query). */
  loadMoreHierarchySearch = async (key: string): Promise<void> =>
    this.#hierarchySearch.loadMore(key);
}

export type Action = Pick<ResourceManagerStoreActionImpl, keyof ResourceManagerStoreActionImpl>;

export const createResourceManagerStoreSlice = (set: Setter, get: () => Store, _api?: unknown) =>
  new ResourceManagerStoreActionImpl(set, get, _api);

type CreateStore = (
  initState?: Partial<State>,
) => StateCreator<Store, [['zustand/devtools', never]]>;

export const store: CreateStore =
  (publicState) =>
  (...params) => ({
    ...initialState,
    ...publicState,
    ...flattenActions<Action>([createResourceManagerStoreSlice(...params)]),
  });
