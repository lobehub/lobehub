import { useGlobalStore } from '@/store/global';
import { type LobeDocument } from '@/types/document';

import type { PageState } from '../../initialState';
import { PAGE_LIST_KEY } from '../../projection';

const EMPTY_DOCUMENTS: LobeDocument[] = [];

const pageList = (s: PageState) => s.pageListMap[PAGE_LIST_KEY];

const sidebarPageSize = (): number => useGlobalStore.getState().status.pagePageSize || 20;

/**
 * Whether the page list has a value to show (hydrated from IndexedDB or
 * confirmed by the server). Its absence is the only loading signal.
 */
const isPageListInit = (s: PageState): boolean => pageList(s) !== undefined;

/** Documents are still loading (the list entry has no value yet). */
const isDocumentsLoading = (s: PageState): boolean => !isPageListInit(s);

const getFilteredDocuments = (s: PageState): LobeDocument[] => {
  const docs = pageList(s)?.items ?? EMPTY_DOCUMENTS;

  const { searchKeywords, showOnlyPagesNotInLibrary } = s;

  let result = docs;

  // Filter out documents with sourceType='file'
  result = result.filter((doc: LobeDocument) => doc.sourceType !== 'file');

  // Filter by library membership
  if (showOnlyPagesNotInLibrary) {
    result = result.filter((doc: LobeDocument) => {
      // Show only pages that are NOT in any library
      // Pages in a library have metadata.knowledgeBaseId set
      return !doc.metadata?.knowledgeBaseId;
    });
  }

  // Filter by search keywords
  if (searchKeywords.trim()) {
    const lowerKeywords = searchKeywords.toLowerCase();
    result = result.filter((doc: LobeDocument) => {
      const content = doc.content?.toLowerCase() || '';
      const title = doc.title?.toLowerCase() || '';
      return content.includes(lowerKeywords) || title.includes(lowerKeywords);
    });
  }

  // Sort by creation date (newest first)
  return result.sort((a: LobeDocument, b: LobeDocument) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
};

// Limited filtered documents for sidebar display
const getFilteredDocumentsLimited = (s: PageState): LobeDocument[] =>
  getFilteredDocuments(s).slice(0, sidebarPageSize());

/**
 * One page as the loaded list holds it, falling back to the by-id projection
 * for pages outside it (mobile mounts no sidebar; a deep link may land before
 * the list fetches), and finally to a Docs sidebar section or its full list.
 *
 * The sections load their own rows (`pageSectionMap`), so on a fresh Docs load
 * a page can be on screen while the flat list has not fetched it yet. Rename,
 * duplicate and delete all resolve the row through this selector, so leaving
 * the sections out made those actions a silent no-op on exactly those rows.
 *
 * Returns the stored object, so a component subscribing to this selector keeps
 * a stable reference until the page actually changes.
 */
const getDocumentById = (docId: string | undefined) => (s: PageState) => {
  if (!docId) return undefined;

  const listRow = pageList(s)?.items.find((doc) => doc.id === docId);
  if (listRow) return listRow;

  const detailRow = s.pageDetailMap[docId];
  if (detailRow) return detailRow;

  const sectionRow = Object.values(s.pageSectionMap)
    .flat()
    .find((doc) => doc.id === docId);
  if (sectionRow) return sectionRow;

  // The full-list panel pages older rows that no section head holds.
  return Object.values(s.pageSectionListMap)
    .flatMap((list) => list.items)
    .find((doc) => doc.id === docId);
};

const hasMoreDocuments = (s: PageState): boolean => Boolean(pageList(s)?.hasMore);

const isLoadingMoreDocuments = (s: PageState): boolean => Boolean(pageList(s)?.isLoadingMore);

const documentsTotal = (s: PageState): number => pageList(s)?.total ?? 0;

// Check if filtered documents have more than displayed
const hasMoreFilteredDocuments = (s: PageState): boolean =>
  getFilteredDocuments(s).length > sidebarPageSize();

// Get total count of filtered documents
const filteredDocumentsCount = (s: PageState): number => getFilteredDocuments(s).length;

export const listSelectors = {
  documentsTotal,
  filteredDocumentsCount,
  getDocumentById,
  getFilteredDocuments,
  getFilteredDocumentsLimited,
  hasMoreDocuments,
  hasMoreFilteredDocuments,
  isDocumentsLoading,
  isLoadingMoreDocuments,
  isPageListInit,
};
