import { type FilesStoreState } from '../../initialState';

/**
 * Resolve the document row an item id refers to, if this client holds it.
 *
 * Reads the replica view: a persisted row paints on the first frame, and a
 * locally written row (created or optimistically renamed) is the same entry.
 */
const getDocumentById = (documentId: string | undefined) => (s: FilesStoreState) => {
  if (!documentId) return undefined;

  return s.documentMap[documentId]?.document ?? undefined;
};

export const documentSelectors = {
  getDocumentById,
};
