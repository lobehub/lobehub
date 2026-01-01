import { type LobeDocument } from '@/types/document';

export interface DocumentQueryFilter {
  fileTypes?: string[];
  sourceTypes?: string[];
}

export interface DocumentState {
  /**
   * whether all pages drawer is open
   */
  allPagesDrawerOpen: boolean;
  /**
   * current page number (0-based)
   */
  currentPage: number;
  /**
   * Filters used in the last document query
   */
  documentQueryFilter?: DocumentQueryFilter;
  /**
   * Server documents fetched from document service
   */
  documents: LobeDocument[];
  /**
   * total count of documents
   */
  documentsTotal: number;
  /**
   * whether there are more documents to load
   */
  hasMoreDocuments: boolean;
  /**
   * Whether currently creating a new document
   */
  isCreatingNew: boolean;
  /**
   * Loading state for document fetching
   */
  isDocumentListLoading: boolean;
  /**
   * loading more documents state
   */
  isLoadingMoreDocuments: boolean;
  /**
   * Local optimistic document map for immediate UI updates
   */
  localDocumentMap: Map<string, LobeDocument>;
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
   * Filter to show only pages not in any library (false = show all pages)
   */
  showOnlyPagesNotInLibrary: boolean;
}

export const initialDocumentState: DocumentState = {
  allPagesDrawerOpen: false,
  currentPage: 0,
  documentQueryFilter: undefined,
  documents: [],
  documentsTotal: 0,
  hasMoreDocuments: false,
  isCreatingNew: false,
  isDocumentListLoading: false,
  isLoadingMoreDocuments: false,
  localDocumentMap: new Map(),
  renamingPageId: null,
  searchKeywords: '',
  selectedPageId: null,
  showOnlyPagesNotInLibrary: false,
};
