import type {GenerationBatch} from '@/types/generation';

import type {ImageStoreState} from '../../initialState';
import { generationTopicSelectors } from '../generationTopic/selectors';

// ====== topic batch selectors ====== //

const getGenerationBatchesByTopicId = (topicId: string) => (s: ImageStoreState) => {
  return s.generationBatchesMap[topicId] || [];
};

const currentGenerationBatches = (s: ImageStoreState): GenerationBatch[] => {
  const activeTopicId = generationTopicSelectors.activeGenerationTopicId(s);
  if (!activeTopicId) return [];
  return getGenerationBatchesByTopicId(activeTopicId)(s);
};

const getGenerationBatchByBatchId = (batchId: string) => (s: ImageStoreState) => {
  const batches = currentGenerationBatches(s);
  return batches.find((batch) => batch.id === batchId);
};

const isCurrentGenerationTopicLoaded = (s: ImageStoreState): boolean => {
  const activeTopicId = generationTopicSelectors.activeGenerationTopicId(s);
  if (!activeTopicId) return false;
  return Array.isArray(s.generationBatchesMap[activeTopicId]);
};

// ====== aggregate selectors ====== //

export const generationBatchSelectors = {
  getGenerationBatchesByTopicId,
  currentGenerationBatches,
  getGenerationBatchByBatchId,
  isCurrentGenerationTopicLoaded,
};
