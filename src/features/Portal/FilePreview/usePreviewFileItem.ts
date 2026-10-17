import { useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';
import { type FileListItem } from '@/types/files';

/**
 * The file the FilePreview portal shows, shared by its title, body and menu.
 *
 * A view opened with a pre-resolved `source` renders from it and skips the
 * owner-scoped file fetch (the SWR key is null); every other view reads the
 * file item from the file store, all three callers sharing one request.
 */
export const usePreviewFileItem = () => {
  const previewFileId = useChatStore(chatPortalSelectors.previewFileId);
  const source = useChatStore(chatPortalSelectors.previewFileSource);
  const useFetchFileItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const fetched = useFetchFileItem(source ? undefined : previewFileId);

  const sourceItem = useMemo<FileListItem | undefined>(() => {
    if (!source || !previewFileId) return;
    const createdAt = new Date(0);
    return {
      chunkCount: null,
      chunkingError: null,
      createdAt,
      embeddingError: null,
      // FileViewer falls back to the name's extension when the type is empty.
      fileType: '',
      finishEmbedding: false,
      id: previewFileId,
      name: source.name,
      size: 0,
      sourceType: 'file',
      updatedAt: createdAt,
      url: source.url,
    };
  }, [previewFileId, source]);

  if (sourceItem) return { data: sourceItem, fromSource: true, isLoading: false } as const;

  return {
    data: fetched.data,
    error: fetched.error,
    fromSource: false,
    isLoading: fetched.isLoading,
    mutate: fetched.mutate,
  } as const;
};
