import type { KnowledgeBaseDocumentResult, SearchKnowledgeBaseState } from '../../../types';

/**
 * Full-text hits the card must list in addition to `fileResults`. A parsed file can match on both
 * retrieval paths, and its vector row already represents it.
 */
export const getDocumentOnlyHits = (
  state?: Partial<Pick<SearchKnowledgeBaseState, 'documents' | 'fileResults'>>,
): KnowledgeBaseDocumentResult[] => {
  const fileIds = new Set(state?.fileResults?.map(({ fileId }) => fileId));

  return state?.documents?.filter(({ fileId }) => !fileId || !fileIds.has(fileId)) ?? [];
};
