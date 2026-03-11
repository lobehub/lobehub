import { type SWRResponse } from 'swr';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { documentService } from '@/services/document';
import { useGlobalStore } from '@/store/global';
import { type StoreSetter } from '@/store/types';
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

type Setter = StoreSetter<PageStore>;
export const createListSlice = (set: Setter, get: () => PageStore, _api?: unknown) =>
  new ListActionImpl(set, get, _api);

export class ListActionImpl {
  readonly #get: () => PageStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => PageStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  fetchDocuments = async (): Promise<void> => {
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
      this.#get().internal_dispatchDocuments({ documents, type: 'setDocuments' });

      this.#set(
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
  };

  loadMoreDocuments = async (): Promise<void> => {
    const { currentPage, isLoadingMoreDocuments, hasMoreDocuments, queryFilter, documents } =
      this.#get();

    if (isLoadingMoreDocuments || !hasMoreDocuments || !documents) return;

    const nextPage = currentPage + 1;

    this.#set({ isLoadingMoreDocuments: true }, false, n('loadMoreDocuments/start'));

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
      this.#get().internal_dispatchDocuments({ documents: newDocuments, type: 'appendDocuments' });

      this.#set(
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
      this.#set({ isLoadingMoreDocuments: false }, false, n('loadMoreDocuments/error'));
    }
  };

  refreshDocuments = async (): Promise<void> => {
    await this.#get().fetchDocuments();
  };

  setSearchKeywords = (keywords: string): void => {
    this.#set({ searchKeywords: keywords }, false, n('setSearchKeywords'));
  };

  setShowOnlyPagesNotInLibrary = (show: boolean): void => {
    this.#set({ showOnlyPagesNotInLibrary: show }, false, n('setShowOnlyPagesNotInLibrary'));
  };

  useFetchDocuments = (): SWRResponse<LobeDocument[]> => {
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
          this.#get().internal_dispatchDocuments({ documents, type: 'setDocuments' });

          this.#set(
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
  };
}

export type ListAction = Pick<ListActionImpl, keyof ListActionImpl>;
