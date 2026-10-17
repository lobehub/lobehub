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

// Workspace-mode sidebar buckets: split filtered docs into "private" (creator
// only) and "workspace-shared". Personal-mode `visibility` is meaningless — the
// caller decides whether to render the flat list or the dual accordion.
const getPrivateFilteredDocuments = (s: PageState): LobeDocument[] =>
  getFilteredDocuments(s).filter((doc) => doc.visibility === 'private');

const getWorkspaceFilteredDocuments = (s: PageState): LobeDocument[] =>
  getFilteredDocuments(s).filter((doc) => doc.visibility !== 'private');

// Bucket-scoped, sidebar-sized page slices — mirror the Limited helper for the
// dual-accordion Pages sidebar so each bucket paginates independently.
const getPrivateFilteredDocumentsLimited = (s: PageState): LobeDocument[] =>
  getPrivateFilteredDocuments(s).slice(0, sidebarPageSize());

const getWorkspaceFilteredDocumentsLimited = (s: PageState): LobeDocument[] =>
  getWorkspaceFilteredDocuments(s).slice(0, sidebarPageSize());

const privateFilteredDocumentsCount = (s: PageState): number =>
  getPrivateFilteredDocuments(s).length;

const workspaceFilteredDocumentsCount = (s: PageState): number =>
  getWorkspaceFilteredDocuments(s).length;

const hasMorePrivateFilteredDocuments = (s: PageState): boolean =>
  getPrivateFilteredDocuments(s).length > sidebarPageSize();

const hasMoreWorkspaceFilteredDocuments = (s: PageState): boolean =>
  getWorkspaceFilteredDocuments(s).length > sidebarPageSize();

/**
 * One page as the loaded list holds it, falling back to the by-id projection
 * for pages outside it (mobile mounts no sidebar; a deep link may land before
 * the list fetches). Returns the stored object, so a component subscribing to
 * this selector keeps a stable reference until the page actually changes.
 */
const getDocumentById = (docId: string | undefined) => (s: PageState) => {
  if (!docId) return undefined;
  return pageList(s)?.items.find((doc) => doc.id === docId) ?? s.pageDetailMap[docId];
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
  getPrivateFilteredDocuments,
  getPrivateFilteredDocumentsLimited,
  getWorkspaceFilteredDocuments,
  getWorkspaceFilteredDocumentsLimited,
  hasMoreDocuments,
  hasMoreFilteredDocuments,
  hasMorePrivateFilteredDocuments,
  hasMoreWorkspaceFilteredDocuments,
  isDocumentsLoading,
  isLoadingMoreDocuments,
  isPageListInit,
  privateFilteredDocumentsCount,
  workspaceFilteredDocumentsCount,
};
