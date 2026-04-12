import { useCallback } from 'react';

import { mutate } from '@/libs/swr';
import { documentService } from '@/services/document';

/**
 * Returns a callback to prefetch page/document data into the SWR cache.
 * Call the returned function on mouseEnter to warm the cache before navigation.
 */
export const usePrefetchPage = () => {
  return useCallback((documentId: string) => {
    if (!documentId) return;

    // Prefetch individual document content (for the editor)
    mutate(['document/editor', documentId], documentService.getDocumentById(documentId), {
      revalidate: false,
    });

    // Prefetch page documents list (for the sidebar)
    mutate(['pageDocuments'], documentService.getPageDocuments(), {
      revalidate: false,
    });
  }, []);
};
