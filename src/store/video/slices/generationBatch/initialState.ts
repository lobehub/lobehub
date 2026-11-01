import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type GenerationBatch } from '@/types/generation';

export interface GenerationBatchState {
  /**
   * Generation batches per topic id. View of the `generationBatches` replica,
   * read through `generationBatchSelectors`; a topic key is absent until its
   * batches have been hydrated or confirmed.
   */
  generationBatchesMap: Record<string, GenerationBatch[]>;
  /** Replica bookkeeping of `generationBatchesMap`. */
  generationBatchesReplica: ReplicaState<GenerationBatch[]>;
}

export const initialGenerationBatchState: GenerationBatchState = {
  generationBatchesMap: {},
  generationBatchesReplica: createReplicaState(),
};
