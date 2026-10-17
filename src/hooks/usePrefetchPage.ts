import { useCallback } from 'react';

import { useDocumentStore } from '@/store/document';

/**
 * Returns a callback to prefetch the document detail before navigation.
 * Call the returned function on mouseEnter to warm the replica so the editor
 * paints from the projection instead of a skeleton.
 *
 * The Pages sidebar list is no longer an SWR cache entry — it is a
 * `@lobechat/replica` resource that hydrates from IndexedDB on mount — so only
 * the document detail is warmed here.
 */
export const usePrefetchPage = () => {
  return useCallback((documentId: string) => {
    if (!documentId) return;

    // Prefetch the document detail into its replica (for the editor)
    void useDocumentStore.getState().prefetchDocument(documentId);
  }, []);
};
