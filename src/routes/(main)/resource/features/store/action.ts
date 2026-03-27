import type { StateCreator } from 'zustand/vanilla';

import type { ResourceManagerMode } from '@/features/ResourceManager';
import type { StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';
import type { FilesTabs, SortType } from '@/types/files';

import type { SelectAllState, State, ViewMode } from './initialState';
import { initialState } from './initialState';

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

export class ResourceManagerStoreActionImpl {
  readonly #get: () => Store;
  readonly #set: Setter;

  constructor(set: Setter, get: () => Store, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  clearSelectAllState = (): void => {
    this.#set({ selectAllState: 'none', selectedFileIds: [] });
  };

  handleBackToList = (): void => {
    this.#set({ currentViewItemId: undefined, mode: 'explorer' });
  };

  onActionClick = async (type: MultiSelectActionType): Promise<void> => {
    const { libraryId, resolveSelectedResourceIds, selectAllState, selectedFileIds } = this.#get();
    const { useFileStore } = await import('@/store/file');
    const { useKnowledgeBaseStore } = await import('@/store/library');
    const { isChunkingUnsupported } = await import('@/utils/isChunkingUnsupported');

    const fileStore = useFileStore.getState();
    const kbStore = useKnowledgeBaseStore.getState();

    switch (type) {
      case 'delete': {
        if (selectAllState === 'all' && selectedFileIds.length === 0 && fileStore.queryParams) {
          const { resourceService } = await import('@/services/resource');

          await resourceService.deleteResourcesByQuery(fileStore.queryParams as any);
          fileStore.clearCurrentQueryResources();

          this.#set({ selectAllState: 'none', selectedFileIds: [] });
          return;
        }

        const resourceIds =
          selectAllState === 'all' ? await resolveSelectedResourceIds() : selectedFileIds;

        await fileStore.deleteResources(resourceIds);

        this.#set({ selectAllState: 'none', selectedFileIds: [] });
        return;
      }

      case 'removeFromKnowledgeBase': {
        const resourceIds = await resolveSelectedResourceIds();
        if (!libraryId) return;

        await kbStore.removeFilesFromKnowledgeBase(libraryId, resourceIds);
        this.#set({ selectAllState: 'none', selectedFileIds: [] });
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
          return !isChunkingUnsupported(resource.fileType);
        });

        await fileStore.parseFilesToChunks(chunkableFileIds, { skipExist: true });
        this.#set({ selectAllState: 'none', selectedFileIds: [] });
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
    this.#set({ selectedFileIds, selectAllState: 'loaded' });
  };

  selectAllResources = (): void => {
    this.#set({ selectAllState: 'all', selectedFileIds: [] });
  };

  setCategory = (category: FilesTabs): void => {
    this.#set({ category });
  };

  setCurrentViewItemId = (currentViewItemId?: string): void => {
    this.#set({ currentViewItemId });
  };

  setLibraryId = (libraryId?: string): void => {
    this.#set({ libraryId });
  };

  setMode = (mode: ResourceManagerMode): void => {
    this.#set({ mode });
  };

  setPendingRenameItemId = (pendingRenameItemId: string | null): void => {
    this.#set({ pendingRenameItemId });
  };

  setSearchQuery = (searchQuery: string | null): void => {
    this.#set({ searchQuery });
  };

  setSelectAllState = (selectAllState: SelectAllState): void => {
    this.#set({ selectAllState });
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
