import { useGlobalStore } from '@/store/global';
import { type LobeDocument } from '@/types/document';

import { type FilesStoreState } from '../../initialState';

const getDocumentById = (documentId: string | undefined) => (s: FilesStoreState) => {
  if (!documentId) return undefined;

  // First check local optimistic map
  const localDocument = s.localDocumentMap.get(documentId);

  // Then check server documents
  const serverDocument = s.documents.find((doc) => doc.id === documentId);

  // If both exist, prefer the local update if it's newer
  if (localDocument && serverDocument) {
    return new Date(localDocument.updatedAt) >= new Date(serverDocument.updatedAt)
      ? localDocument
      : serverDocument;
  }

  // Return whichever exists, or undefined if neither exists
  return localDocument || serverDocument;
};

const getFilteredPages = (s: FilesStoreState): LobeDocument[] => {
  // Merge local optimistic map with server documents
  const localPages = Array.from(s.localDocumentMap.values());
  const serverPages = s.documents.filter((doc) => !s.localDocumentMap.has(doc.id));
  const pages = [...localPages, ...serverPages];

  const { searchKeywords, showOnlyPagesNotInLibrary } = s;

  let result = pages;

  // Filter out documents with sourceType='file'
  result = result.filter((page: LobeDocument) => page.sourceType !== 'file');

  // Filter by library membership
  if (showOnlyPagesNotInLibrary) {
    result = result.filter((page: LobeDocument) => {
      // Show only pages that are NOT in any library
      // Pages in a library have metadata.knowledgeBaseId set
      return !page.metadata?.knowledgeBaseId;
    });
  }

  // Filter by search keywords
  if (searchKeywords.trim()) {
    const lowerKeywords = searchKeywords.toLowerCase();
    result = result.filter((page: LobeDocument) => {
      const content = page.content?.toLowerCase() || '';
      const title = page.title?.toLowerCase() || '';
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

// Limited filtered pages for sidebar display
const getFilteredPagesLimited = (s: FilesStoreState): LobeDocument[] => {
  const pageSize = useGlobalStore.getState().status.pagePageSize || 20;
  const allPages = getFilteredPages(s);
  return allPages.slice(0, pageSize);
};

const hasMoreDocuments = (s: FilesStoreState): boolean => s.hasMoreDocuments;

const isLoadingMoreDocuments = (s: FilesStoreState): boolean => s.isLoadingMoreDocuments;

const documentsTotal = (s: FilesStoreState): number => s.documentsTotal;

// Check if filtered pages have more than displayed
const hasMoreFilteredPages = (s: FilesStoreState): boolean => {
  const pageSize = useGlobalStore.getState().status.pagePageSize || 20;
  const allPages = getFilteredPages(s);
  return allPages.length > pageSize;
};

// Get total count of filtered pages
const filteredPagesCount = (s: FilesStoreState): number => {
  return getFilteredPages(s).length;
};

export const documentSelectors = {
  documentsTotal,
  filteredPagesCount,
  getDocumentById,
  getFilteredPages,
  getFilteredPagesLimited,
  hasMoreDocuments,
  hasMoreFilteredPages,
  isLoadingMoreDocuments,
};
