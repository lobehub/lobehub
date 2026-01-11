import { useGlobalStore } from '@/store/global';
import { type LobeDocument } from '@/types/document';

import { type PageState } from '../../initialState';

/**
 * Check if documents are still loading (undefined means not yet loaded)
 */
const isDocumentsLoading = (s: PageState): boolean => s.documents === undefined;

const getFilteredDocuments = (s: PageState): LobeDocument[] => {
  const docs = s.documents ?? [];

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
const getFilteredDocumentsLimited = (s: PageState): LobeDocument[] => {
  const pageSize = useGlobalStore.getState().status.pagePageSize || 20;
  const allDocs = getFilteredDocuments(s);
  return allDocs.slice(0, pageSize);
};

const getDocumentById = (docId: string | undefined) => (s: PageState) => {
  if (!docId) return undefined;

  // Find in documents array
  return s.documents?.find((doc) => doc.id === docId);
};

const hasMoreDocuments = (s: PageState): boolean => s.hasMoreDocuments;

const isLoadingMoreDocuments = (s: PageState): boolean => s.isLoadingMoreDocuments;

const documentsTotal = (s: PageState): number => s.documentsTotal;

// Check if filtered documents have more than displayed
const hasMoreFilteredDocuments = (s: PageState): boolean => {
  const pageSize = useGlobalStore.getState().status.pagePageSize || 20;
  const allDocs = getFilteredDocuments(s);
  return allDocs.length > pageSize;
};

// Get total count of filtered documents
const filteredDocumentsCount = (s: PageState): number => {
  return getFilteredDocuments(s).length;
};

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
};
