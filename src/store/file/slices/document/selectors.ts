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

/**
 * Get all documents merged from local optimistic map and server data
 */
const getOptimisticDocuments = (s: FilesStoreState): LobeDocument[] => {
  // Track which documents we've added
  const addedIds = new Set<string>();

  // Create result array - start with server documents
  const result: LobeDocument[] = s.documents.map((doc) => {
    addedIds.add(doc.id);
    // Check if we have a local optimistic update for this document
    const localUpdate = s.localDocumentMap.get(doc.id);
    // If local update exists and is newer, use it; otherwise use server version
    if (localUpdate && new Date(localUpdate.updatedAt) >= new Date(doc.updatedAt)) {
      return localUpdate;
    }
    return doc;
  });

  // Add any optimistic documents that aren't in server list yet (e.g., newly created temp documents)
  for (const [id, doc] of s.localDocumentMap.entries()) {
    if (!addedIds.has(id)) {
      result.unshift(doc); // Add new documents to the beginning
    }
  }

  return result;
};

const hasMoreDocuments = (s: FilesStoreState): boolean => s.hasMoreDocuments;

const isLoadingMoreDocuments = (s: FilesStoreState): boolean => s.isLoadingMoreDocuments;

const documentsTotal = (s: FilesStoreState): number => s.documentsTotal;

export const documentSelectors = {
  documentsTotal,
  getDocumentById,
  getOptimisticDocuments,
  hasMoreDocuments,
  isLoadingMoreDocuments,
};
