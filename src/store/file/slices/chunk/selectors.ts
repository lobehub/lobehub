import { type FilesStoreState } from '@/store/file/initialState';

const showSimilaritySearchResult = (s: FilesStoreState) => s.isSimilaritySearch;
const enabledChunkFileId = (s: FilesStoreState) => s.chunkDetailId;

export const fileChunkSelectors = {
  enabledChunkFileId,
  showSimilaritySearchResult,
};
