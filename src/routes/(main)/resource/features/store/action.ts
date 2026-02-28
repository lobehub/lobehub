import { type StateCreator } from 'zustand/vanilla';

import { type ResourceManagerMode } from '@/features/ResourceManager';
import { type FilesTabs, type SortType } from '@/types/files';

import { type State, type ViewMode } from './initialState';
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

export interface Action {
  /**
   * Handle navigating back to list from file preview
   */
  handleBackToList: () => void;
  /**
   * Load more knowledge items (pagination)
   */
  loadMoreKnowledgeItems: () => Promise<void>;
  /**
   * Handle multi-select actions (delete, chunking, KB operations, etc.)
   */
  onActionClick: (type: MultiSelectActionType) => Promise<void>;
  /**
   * Set the current file category filter
   */
  setCategory: (category: FilesTabs) => void;
  /**
   * Set the current folder ID
   */
  setCurrentFolderId: (folderId: string | null | undefined) => void;
  /**
   * Set the current view item ID
   */
  setCurrentViewItemId: (id?: string) => void;
  /**
   * Set whether there are more files to load
   */
  setFileListHasMore: (value: boolean) => void;
  /**
   * Set the pagination offset
   */
  setFileListOffset: (value: number) => void;
  /**
   * Set masonry ready state
   */
  setIsMasonryReady: (value: boolean) => void;
  /**
   * Set view transition state
   */
  setIsTransitioning: (value: boolean) => void;
  /**
   * Set the current library ID
   */
  setLibraryId: (id?: string) => void;
  /**
   * Set the view mode
   */
  setMode: (mode: ResourceManagerMode) => void;
  /**
   * Set the pending rename item ID
   */
  setPendingRenameItemId: (id: string | null) => void;
  /**
   * Set search query
   */
  setSearchQuery: (query: string | null) => void;
  /**
   * Set selected file IDs
   */
  setSelectedFileIds: (ids: string[]) => void;
  /**
   * Set the field to sort files by
   */
  setSorter: (sorter: 'name' | 'createdAt' | 'size') => void;
  /**
   * Set the sort direction
   */
  setSortType: (sortType: SortType) => void;
  /**
   * Set the file explorer view mode
   */
  setViewMode: (viewMode: ViewMode) => void;
}

export type Store = Action & State;

type CreateStore = (
  initState?: Partial<State>,
) => StateCreator<Store, [['zustand/devtools', never]]>;

export const store: CreateStore = (publicState) => (set, get) => ({
  ...initialState,
  ...publicState,

  handleBackToList: () => {
    set({ currentViewItemId: undefined, mode: 'explorer' });
  },

  loadMoreKnowledgeItems: async () => {
    const { fileListHasMore } = get();

    // Don't load if there's no more data
    if (!fileListHasMore) return;

    const { useFileStore } = await import('@/store/file');
    const fileStore = useFileStore.getState();

    // Delegate to FileStore's loadMoreKnowledgeItems
    await fileStore.loadMoreKnowledgeItems();

    // Sync pagination state back to ResourceManagerStore
    set({
      fileListHasMore: fileStore.fileListHasMore,
      fileListOffset: fileStore.fileListOffset,
    });
  },

  onActionClick: async (type) => {
    const { selectedFileIds, libraryId } = get();
    const { useFileStore } = await import('@/store/file');
    const { useKnowledgeBaseStore } = await import('@/store/library');
    const { isChunkingUnsupported } = await import('@/utils/isChunkingUnsupported');

    const fileStore = useFileStore.getState();
    const kbStore = useKnowledgeBaseStore.getState();

    switch (type) {
      case 'delete': {
        await fileStore.deleteResources(selectedFileIds);

        set({ selectedFileIds: [] });
        return;
      }

      case 'removeFromKnowledgeBase': {
        if (!libraryId) return;
        await kbStore.removeFilesFromKnowledgeBase(libraryId, selectedFileIds);
        set({ selectedFileIds: [] });
        return;
      }

      case 'addToKnowledgeBase': {
        // Modal operations need to be handled in component layer
        // Store just marks that action was requested
        // Component will handle opening modal via useAddFilesToKnowledgeBaseModal hook
        return;
      }

      case 'moveToOtherKnowledgeBase': {
        // Modal operations need to be handled in component layer
        // Store just marks that action was requested
        // Component will handle opening modal via useAddFilesToKnowledgeBaseModal hook
        return;
      }

      case 'batchChunking': {
        const chunkableFileIds = selectedFileIds.filter((id) => {
          const resource = fileStore.resourceMap?.get(id);
          return resource && !isChunkingUnsupported(resource.fileType);
        });
        await fileStore.parseFilesToChunks(chunkableFileIds, { skipExist: true });
        set({ selectedFileIds: [] });
        return;
      }

      case 'deleteLibrary': {
        if (!libraryId) return;
        await kbStore.removeKnowledgeBase(libraryId);
        // Navigate to knowledge base page using window.location
        // (can't use useNavigate hook from store)
        if (typeof window !== 'undefined') {
          window.location.href = '/knowledge';
        }
        return;
      }
    }
  },

  setCategory: (category) => {
    set({ category });
  },

  setCurrentFolderId: (currentFolderId) => {
    set({ currentFolderId });
  },

  setCurrentViewItemId: (currentViewItemId) => {
    set({ currentViewItemId });
  },

  setFileListHasMore: (fileListHasMore) => {
    set({ fileListHasMore });
  },

  setFileListOffset: (fileListOffset) => {
    set({ fileListOffset });
  },

  setIsMasonryReady: (isMasonryReady) => {
    set({ isMasonryReady });
  },

  setIsTransitioning: (isTransitioning) => {
    set({ isTransitioning });
  },

  setLibraryId: (libraryId) => {
    set({ libraryId });

    // Reset pagination state when switching libraries to prevent showing stale data
    set({
      fileListHasMore: false,
      fileListOffset: 0,
    });

    // Note: No need to manually refresh - Explorer's useEffect will automatically
    // call fetchResources when libraryId changes
  },

  setMode: (mode) => {
    set({ mode });
  },

  setPendingRenameItemId: (pendingRenameItemId) => {
    set({ pendingRenameItemId });
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery });
  },

  setSelectedFileIds: (selectedFileIds) => {
    set({ selectedFileIds });
  },

  setSortType: (sortType) => {
    set({ sortType });
  },

  setSorter: (sorter) => {
    set({ sorter });
  },

  setViewMode: (viewMode) => {
    set({ viewMode });
  },
});
