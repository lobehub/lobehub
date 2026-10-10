import { defineReplica } from '@/libs/replica';
import type { GenerationBatch } from '@/types/generation';

export interface GenerationBatchesParams {
  topicId: string;
}

/**
 * Generation batches are owned by one topic and fetched per topic, so the
 * replica keeps one entry per topic id (`generationBatchesMap[topicId]`) and
 * two topics never share — or reset — one list. The identity scope partitions
 * the entries the same way it partitions the topic list.
 */
export const generationBatchesResource = defineReplica<GenerationBatchesParams, GenerationBatch[]>({
  key: ({ topicId }) => topicId,
  name: 'videoGenerationBatches',
  storage: 'indexedDB',
  version: 1,
});
