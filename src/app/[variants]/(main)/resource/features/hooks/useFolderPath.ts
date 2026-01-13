import { useLocation, useParams } from 'react-router-dom';

/**
 * Hook to extract folder slug from URL
 * Supports Google Drive-style slug-based folder navigation
 *
 * Example URLs:
 * - /resource/library/kb_123 -> { knowledgeBaseId: 'kb_123', currentFolderSlug: null, isInKnowledgeBase: true }
 * - /resource/library/kb_123/folder-slug-1 -> { knowledgeBaseId: 'kb_123', currentFolderSlug: 'folder-slug-1', isInKnowledgeBase: true }
 * - /knowledge -> { knowledgeBaseId: null, currentFolderSlug: null, isInKnowledgeBase: false }
 */
export const useFolderPath = () => {
  const params = useParams<{ id: string; slug?: string }>();
  const location = useLocation();

  // Extract knowledge base ID from params
  const knowledgeBaseId = params.id || null;

  // Determine if we're in a knowledge base context
  const isInKnowledgeBase = location.pathname.includes('/resource/library/');

  // Extract folder slug from params (single slug, not nested paths)
  const currentFolderSlug = params.slug || null;

  return {
    currentFolderSlug,
    isInKnowledgeBase,
    knowledgeBaseId,
  };
};
