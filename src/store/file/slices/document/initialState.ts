import { type LobeDocument } from '@/types/document';

export interface DocumentQueryFilter {
  fileTypes?: string[];
  sourceTypes?: string[];
}

export interface DocumentState {
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
}

export const initialDocumentState: DocumentState = {
  currentPage: 0,
  documentQueryFilter: undefined,
  documents: [],
  documentsTotal: 0,
  hasMoreDocuments: false,
  isDocumentListLoading: false,
  isLoadingMoreDocuments: false,
  localDocumentMap: new Map(),
};
