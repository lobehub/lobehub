import { memo } from 'react';

import FileParsingStatusTag from '@/components/FileParsingStatus';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type FileParsingTask } from '@/types/asyncTask';

interface ChunkTagProps extends FileParsingTask {
  id: string;
}

const ChunksBadge = memo<ChunkTagProps>(({ id, ...res }) => {
  const [
    isCreatingChunkEmbeddingTask,
    embeddingChunks,
    reParseFile,
    openChunkDrawer,
    reEmbeddingChunks,
  ] = useFileStore((s) => [
    fileManagerSelectors.isCreatingChunkEmbeddingTask(id)(s),
    s.embeddingChunks,
    s.reParseFile,
    s.openChunkDrawer,
    s.reEmbeddingChunks,
  ]);

  return (
    <FileParsingStatusTag
      preparingEmbedding={isCreatingChunkEmbeddingTask}
      onEmbeddingClick={() => embeddingChunks([id])}
      onClick={(status) => {
        if (status === 'success') openChunkDrawer(id);
      }}
      onErrorClick={(task) => {
        if (task === 'chunking') reParseFile(id);
        if (task === 'embedding') reEmbeddingChunks(id);
      }}
      {...res}
    />
  );
});

export default ChunksBadge;
