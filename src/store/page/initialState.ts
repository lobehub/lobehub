import { type NavigateFunction } from 'react-router-dom';

import { type LobeDocument } from '@/types/document';

export interface PageQueryFilter {
  fileTypes?: string[];
  sourceTypes?: string[];
}

export interface PageState {
  // ===== Selection & Navigation =====
  /**
   * Whether all pages drawer is open
   */
  allPagesDrawerOpen: boolean;
  // ===== List Management =====
  /**
   * Current page number (0-based) for pagination
   */
  currentPage: number;
  /**
   * Server documents fetched from document service
   * undefined means not yet loaded (loading state)
   */
  documents?: LobeDocument[];
  /**
   * Total count of documents
   */
  documentsTotal: number;
  /**
   * Whether there are more documents to load
   */
  hasMoreDocuments: boolean;
  // ===== UI State =====
  /**
   * Whether currently creating a new page
   */
  isCreatingNew: boolean;
  /**
   * Loading state for pagination (load more)
   */
  isLoadingMoreDocuments: boolean;

  navigate?: NavigateFunction;
  /**
   * Filters used in the last query
   */
  queryFilter?: PageQueryFilter;

  /**
   * ID of the page being renamed (null if none)
   */
  renamingPageId: string | null;
  /**
   * Search keywords for filtering pages
   */
  searchKeywords: string;
  /**
   * Currently selected page ID
   */
  selectedPageId: string | null;
  /**
   * Filter to show only pages not in any library
   */
  showOnlyPagesNotInLibrary: boolean;
}

export const initialState: PageState = {
  // Selection & Navigation
  allPagesDrawerOpen: false,

  // List Management
  currentPage: 0,

  documents: undefined,

  documentsTotal: 0,

  hasMoreDocuments: false,

  // UI State
  isCreatingNew: false,

  isLoadingMoreDocuments: false,

  queryFilter: undefined,

  renamingPageId: null,
  searchKeywords: '',
  selectedPageId: null,
  showOnlyPagesNotInLibrary: false,
};
