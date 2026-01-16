import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { documentService } from '@/services/document';
import { useGlobalStore } from '@/store/global';
import { type LobeDocument } from '@/types/document';
import { setNamespace } from '@/utils/storeDebug';

import { type PageQueryFilter } from '../../initialState';
import { type PageStore } from '../../store';

const n = setNamespace('page/list');

const ALLOWED_PAGE_SOURCE_TYPES = new Set(['editor', 'file', 'api']);
const ALLOWED_PAGE_FILE_TYPES = new Set(['custom/document', 'application/pdf']);

/**
 * Check if a page should be displayed in the page list
 */
const isAllowedPage = (page: { fileType: string; sourceType: string }) => {
  return (
    ALLOWED_PAGE_SOURCE_TYPES.has(page.sourceType) && ALLOWED_PAGE_FILE_TYPES.has(page.fileType)
  );
};

export interface ListAction {
  /**
   * Fetch documents from the server with pagination
   */
  fetchDocuments: () => Promise<void>;
  /**
   * Load more documents (next page)
   */
  loadMoreDocuments: () => Promise<void>;
  /**
   * Refresh document list (re-fetch from server)
   */
  refreshDocuments: () => Promise<void>;
  /**
   * Set search keywords
   */
  setSearchKeywords: (keywords: string) => void;
  /**
   * Toggle filter to show only pages not in any library
   */
  setShowOnlyPagesNotInLibrary: (show: boolean) => void;
  /**
   * SWR hook to fetch documents list with caching and auto-sync to store
   */
  useFetchDocuments: () => SWRResponse<LobeDocument[]>;
}

export const createListSlice: StateCreator<
  PageStore,
  [['zustand/devtools', never]],
  [],
  ListAction
> = (set, get) => ({
  fetchDocuments: async () => {
    try {
      const pageSize = useGlobalStore.getState().status.pagePageSize || 20;
      const queryFilters: PageQueryFilter = {
        fileTypes: Array.from(ALLOWED_PAGE_FILE_TYPES),
        sourceTypes: Array.from(ALLOWED_PAGE_SOURCE_TYPES),
      };

      const result = await documentService.queryDocuments({
        current: 0,
        pageSize,
        ...queryFilters,
      });

      const documents = result.items.filter(isAllowedPage).map((doc) => ({
        ...doc,
        filename: doc.filename ?? doc.title ?? 'Untitled',
      })) as LobeDocument[];

      const hasMore = result.items.length >= pageSize;

      // Use internal dispatch to set documents
      get().internal_dispatchDocuments({ documents, type: 'setDocuments' });

      set(
        {
          currentPage: 0,
          documentsTotal: result.total,
          hasMoreDocuments: hasMore,
          queryFilter: queryFilters,
        },
        false,
        n('fetchDocuments/success'),
      );
    } catch (error) {
      console.error('Failed to fetch documents:', error);
      throw error;
    }
  },

  loadMoreDocuments: async () => {
    const { currentPage, isLoadingMoreDocuments, hasMoreDocuments, queryFilter, documents } = get();

    if (isLoadingMoreDocuments || !hasMoreDocuments || !documents) return;

    const nextPage = currentPage + 1;

    set({ isLoadingMoreDocuments: true }, false, n('loadMoreDocuments/start'));

    try {
      const pageSize = useGlobalStore.getState().status.pagePageSize || 20;
      const queryParams = queryFilter
        ? { current: nextPage, pageSize, ...queryFilter }
        : { current: nextPage, pageSize };

      const result = await documentService.queryDocuments(queryParams);

      const newDocuments = result.items.filter(isAllowedPage).map((doc) => ({
        ...doc,
        filename: doc.filename ?? doc.title ?? 'Untitled',
      })) as LobeDocument[];

      const hasMore = result.items.length >= pageSize;

      // Use internal dispatch to append documents
      get().internal_dispatchDocuments({ documents: newDocuments, type: 'appendDocuments' });

      set(
        {
          currentPage: nextPage,
          documentsTotal: result.total,
          hasMoreDocuments: hasMore,
          isLoadingMoreDocuments: false,
        },
        false,
        n('loadMoreDocuments/success'),
      );
    } catch (error) {
      console.error('Failed to load more documents:', error);
      set({ isLoadingMoreDocuments: false }, false, n('loadMoreDocuments/error'));
    }
  },

  refreshDocuments: async () => {
    await get().fetchDocuments();
  },

  setSearchKeywords: (keywords: string) => {
    set({ searchKeywords: keywords }, false, n('setSearchKeywords'));
  },

  setShowOnlyPagesNotInLibrary: (show: boolean) => {
    set({ showOnlyPagesNotInLibrary: show }, false, n('setShowOnlyPagesNotInLibrary'));
  },

  useFetchDocuments: () => {
    return useClientDataSWRWithSync<LobeDocument[]>(
      ['pageDocuments'],
      async () => {
        const pageSize = useGlobalStore.getState().status.pagePageSize || 20;
        const queryFilters: PageQueryFilter = {
          fileTypes: Array.from(ALLOWED_PAGE_FILE_TYPES),
          sourceTypes: Array.from(ALLOWED_PAGE_SOURCE_TYPES),
        };

        const result = await documentService.queryDocuments({
          current: 0,
          pageSize,
          ...queryFilters,
        });

        const documents = result.items.filter(isAllowedPage).map((doc) => ({
          ...doc,
          filename: doc.filename ?? doc.title ?? 'Untitled',
        })) as LobeDocument[];

        return documents;
      },
      {
        onData: (documents) => {
          if (!documents) return;

          const pageSize = useGlobalStore.getState().status.pagePageSize || 20;
          const hasMore = documents.length >= pageSize;

          // Use internal dispatch to set documents
          get().internal_dispatchDocuments({ documents, type: 'setDocuments' });

          set(
            {
              currentPage: 0,
              documentsTotal: documents.length,
              hasMoreDocuments: hasMore,
              queryFilter: {
                fileTypes: Array.from(ALLOWED_PAGE_FILE_TYPES),
                sourceTypes: Array.from(ALLOWED_PAGE_SOURCE_TYPES),
              },
            },
            false,
            n('useFetchDocuments/onData'),
          );
        },
        revalidateOnFocus: true,
      },
    );
  },
});
