import { useEffect } from 'react';

import { useFileStore } from '@/store/file';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type FileListItem } from '@/types/files';

export const useCheckTaskStatus = (data: FileListItem[] | undefined) => {
  const [refreshFileList] = useFileStore((s) => [s.refreshFileList]);
  const hasProcessingChunkTask = data?.some(
    (item) => item.chunkingStatus === AsyncTaskStatus.Processing,
  );
  const hasProcessingEmbeddingTask = data?.some(
    (item) => item.embeddingStatus === AsyncTaskStatus.Processing,
  );

  const isProcessing = hasProcessingChunkTask || hasProcessingEmbeddingTask;

  // every 3s to check if the chunking status is changed
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(refreshFileList, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [isProcessing]);
};
