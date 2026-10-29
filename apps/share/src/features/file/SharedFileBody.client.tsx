'use client';

import type { SharedFileData } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import FileViewer from '@/features/FileViewer';
import { type FileListItem } from '@/types/files';

const SharedFileBody = memo<{ data: SharedFileData }>(({ data }) => {
  const { file } = data;

  // FileViewer renders a library item; a share carries only what a visitor may
  // read, so the rest of the item is inert.
  const item = useMemo<FileListItem>(() => {
    const createdAt = new Date(0);
    return {
      chunkCount: null,
      chunkingError: null,
      createdAt,
      embeddingError: null,
      fileType: file.fileType,
      finishEmbedding: false,
      id: file.id,
      name: file.name,
      size: file.size,
      sourceType: 'file',
      updatedAt: createdAt,
      url: file.previewUrl,
    };
  }, [file]);

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'auto' }}>
      <FileViewer {...item} showChunkHighlights={false} />
    </Flexbox>
  );
});

SharedFileBody.displayName = 'SharedFileBody';

export default SharedFileBody;
