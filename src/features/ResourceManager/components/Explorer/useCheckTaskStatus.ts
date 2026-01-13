import { useEffect } from 'react';

import { revalidateResources } from '@/store/file/slices/resource/hooks';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type FileListItem } from '@/types/files';

export const useCheckTaskStatus = (data: FileListItem[] | undefined) => {
  const hasProcessingChunkTask = data?.some(
    (item) => item.chunkingStatus === AsyncTaskStatus.Processing,
  );
  const hasProcessingEmbeddingTask = data?.some(
    (item) => item.embeddingStatus === AsyncTaskStatus.Processing,
  );

  const isProcessing = hasProcessingChunkTask || hasProcessingEmbeddingTask;

  // Poll every 5s to check if chunking/embedding status has changed
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      // Re-fetch with the same query params used for initial load
      revalidateResources();
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [isProcessing]);
};
