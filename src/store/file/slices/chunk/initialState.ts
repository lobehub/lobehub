import { type SemanticSearchChunk } from '@/types/chunk';

export interface FileChunkState {
  chunkDetailId: string | null;
  highlightChunkIds: string[];
  isSimilaritySearch?: boolean;
  isSimilaritySearching?: boolean;
  similaritySearchChunks?: SemanticSearchChunk[];
}

export const initialFileChunkState: FileChunkState = {
  chunkDetailId: null,
  highlightChunkIds: [],
  similaritySearchChunks: [],
};
