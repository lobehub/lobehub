import { useCallback } from 'react';

import { mutate } from '@/libs/swr';
import { fileService } from '@/services/file';

/**
 * Returns a callback to prefetch resource/file data into the SWR cache.
 * Call the returned function on mouseEnter to warm the cache before navigation.
 */
export const usePrefetchResource = () => {
  return useCallback((fileId: string) => {
    if (!fileId) return;

    const key = ['useFetchKnowledgeItem', fileId] as const;

    mutate(key, fileService.getKnowledgeItem(fileId), {
      revalidate: false,
    });
  }, []);
};
