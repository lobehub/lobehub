import { ragService } from '@/services/rag';
import { type StoreSetter } from '@/store/types';

import { type FileStore } from '../../store';

type Setter = StoreSetter<FileStore>;
export const createFileChunkSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new FileChunkActionImpl(set, get, _api);

export class FileChunkActionImpl {
  readonly #get: () => FileStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  closeChunkDrawer = (): void => {
    this.#set({ chunkDetailId: null, isSimilaritySearch: false, similaritySearchChunks: [] });
  };

  highlightChunks = (ids: string[]): void => {
    this.#set({ highlightChunkIds: ids });
  };

  openChunkDrawer = (id: string): void => {
    this.#set({ chunkDetailId: id });
  };

  semanticSearch = async (text: string, fileId: string): Promise<void> => {
    this.#set({ isSimilaritySearching: true });
    const data = await ragService.semanticSearch(text, [fileId]);
    this.#set({ isSimilaritySearching: false, similaritySearchChunks: data });
  };
}

export type FileChunkAction = Pick<FileChunkActionImpl, keyof FileChunkActionImpl>;
