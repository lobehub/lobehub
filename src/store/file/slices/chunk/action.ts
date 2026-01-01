import { type StateCreator } from 'zustand/vanilla';

import { ragService } from '@/services/rag';

import { type FileStore } from '../../store';

export interface FileChunkAction {
  closeChunkDrawer: () => void;
  highlightChunks: (ids: string[]) => void;

  openChunkDrawer: (id: string) => void;
  semanticSearch: (text: string, fileId: string) => Promise<void>;
}

export const createFileChunkSlice: StateCreator<
  FileStore,
  [['zustand/devtools', never]],
  [],
  FileChunkAction
> = (set) => ({
  closeChunkDrawer: () => {
    set({ chunkDetailId: null, isSimilaritySearch: false, similaritySearchChunks: [] });
  },
  highlightChunks: (ids) => {
    set({ highlightChunkIds: ids });
  },
  openChunkDrawer: (id) => {
    set({ chunkDetailId: id });
  },

  semanticSearch: async (text, fileId) => {
    set({ isSimilaritySearching: true });
    const data = await ragService.semanticSearch(text, [fileId]);
    set({ isSimilaritySearching: false, similaritySearchChunks: data });
  },
});
