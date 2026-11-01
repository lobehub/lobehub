import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

/**
 * Hook to extract the current folder from URL
 *
 * Example URLs:
 * - /resource/library/kb_123 -> { knowledgeBaseId: 'kb_123', currentFolderId: null, isInKnowledgeBase: true }
 * - /resource/library/kb_123/folder/docs_1 -> { knowledgeBaseId: 'kb_123', currentFolderId: 'docs_1', isInKnowledgeBase: true }
 * - /knowledge -> { knowledgeBaseId: null, currentFolderId: null, isInKnowledgeBase: false }
 */
export const useFolderPath = () => {
  // Active-tab variants, not the raw router hooks: `LibraryHierarchy` renders in
  // the sidebar, which Electron portals into the shell's frozen root router.
  const params = useActiveRouteParams<{ folderId?: string; id: string }>();
  const location = useActiveLocation();

  // Extract knowledge base ID from params
  const knowledgeBaseId = params.id || null;

  // Determine if we're in a knowledge base context
  const isInKnowledgeBase = location.pathname.includes('/resource/library/');

  const currentFolderId = params.folderId || null;

  return {
    currentFolderId,
    isInKnowledgeBase,
    knowledgeBaseId,
  };
};
