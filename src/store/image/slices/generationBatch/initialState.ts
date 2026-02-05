import type {GenerationBatch} from '@/types/generation';

export interface GenerationBatchState {
  /**
   * Generation batches mapped by topic ID
   * Key: generationTopicId, Value: array of GenerationBatch
   */
  generationBatchesMap: Record<string, GenerationBatch[]>;
}

export const initialGenerationBatchState: GenerationBatchState = {
  generationBatchesMap: {},
};
