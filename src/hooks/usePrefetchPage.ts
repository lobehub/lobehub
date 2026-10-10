import { useCallback } from 'react';

import { mutate } from '@/libs/swr';
import { documentService } from '@/services/document';
import { documentSWRKeys } from '@/services/document/swrKeys';

/**
 * Returns a callback to prefetch page/document data into the SWR cache.
 * Call the returned function on mouseEnter to warm the cache before navigation.
 *
 * The Pages sidebar list is no longer an SWR cache entry — it is a
 * `@lobechat/replica` resource that hydrates from IndexedDB on mount — so only
 * the editor's document content is warmed here.
 */
export const usePrefetchPage = () => {
  return useCallback((documentId: string) => {
    if (!documentId) return;

    // Prefetch individual document content (for the editor)
    mutate(documentSWRKeys.editor(documentId), documentService.getDocumentById(documentId), {
      revalidate: false,
    });
  }, []);
};
