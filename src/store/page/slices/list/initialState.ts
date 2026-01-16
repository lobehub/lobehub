import { type LobeDocument } from '@/types/document';

import { type PageQueryFilter } from '../../initialState';

export interface ListState {
  currentPage: number;
  documents: LobeDocument[];
  documentsTotal: number;
  hasMoreDocuments: boolean;
  isDocumentListLoading: boolean;
  isLoadingMoreDocuments: boolean;
  localPageMap: Map<string, LobeDocument>;
  queryFilter?: PageQueryFilter;
  searchKeywords: string;
  showOnlyPagesNotInLibrary: boolean;
}

export const initialListState: ListState = {
  currentPage: 0,
  documents: [],
  documentsTotal: 0,
  hasMoreDocuments: false,
  isDocumentListLoading: false,
  isLoadingMoreDocuments: false,
  localPageMap: new Map(),
  queryFilter: undefined,
  searchKeywords: '',
  showOnlyPagesNotInLibrary: false,
};
