import { setNamespace } from '@/utils/storeDebug';
import { type StoreSetter } from '@/store/types';
import { type GenerationBatch } from '@/types/generation';
import { type GenerationBatchState } from './initialState';

const n = setNamespace('audioGenerationBatch');

export interface GenerationBatchAction {
  setGenerationBatchesMap: (map: Record<string, GenerationBatch[]>) => void;
  addGenerationBatch: (topicId: string, batch: GenerationBatch) => void;
  updateGenerationBatches: (topicId: string, batches: GenerationBatch[]) => void;
}

type Setter = StoreSetter<any>;

export const createGenerationBatchSlice = (set: Setter, get: () => any, _api?: unknown) => ({
  setGenerationBatchesMap: (map: Record<string, GenerationBatch[]>) => {
    set({ generationBatchesMap: map }, false, n('setGenerationBatchesMap'));
  },

  addGenerationBatch: (topicId: string, batch: GenerationBatch) => {
    const currentMap = get().generationBatchesMap;
    const currentBatches = currentMap[topicId] || [];
    const newMap = {
      ...currentMap,
      [topicId]: [...currentBatches, batch],
    };
    set({ generationBatchesMap: newMap }, false, n('addGenerationBatch'));
  },

  updateGenerationBatches: (topicId: string, batches: GenerationBatch[]) => {
    const currentMap = get().generationBatchesMap;
    const newMap = {
      ...currentMap,
      [topicId]: batches,
    };
    set({ generationBatchesMap: newMap }, false, n('updateGenerationBatches'));
  },
} as GenerationBatchAction);

export type { GenerationBatchAction };
