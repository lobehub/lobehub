import { type GenerationBatch } from '@/types/generation';

export interface GenerationBatchState {
  generationBatchesMap: Record<string, GenerationBatch[]>;
}

export const initialGenerationBatchState: GenerationBatchState = {
  generationBatchesMap: {},
};
