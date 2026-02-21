import { type GenerationBatch } from '@/types/generation';

import { type VideoStoreState } from '../../initialState';
import { generationTopicSelectors } from '../generationTopic/selectors';

// ====== topic batch selectors ====== //

const getGenerationBatchesByTopicId = (topicId: string) => (s: VideoStoreState) => {
  return s.generationBatchesMap[topicId] || [];
};

const currentGenerationBatches = (s: VideoStoreState): GenerationBatch[] => {
  const activeTopicId = generationTopicSelectors.activeGenerationTopicId(s);
  if (!activeTopicId) return [];
  return getGenerationBatchesByTopicId(activeTopicId)(s);
};

const getGenerationBatchByBatchId = (batchId: string) => (s: VideoStoreState) => {
  const batches = currentGenerationBatches(s);
  return batches.find((batch) => batch.id === batchId);
};

const isCurrentGenerationTopicLoaded = (s: VideoStoreState): boolean => {
  const activeTopicId = generationTopicSelectors.activeGenerationTopicId(s);
  if (!activeTopicId) return false;
  return Array.isArray(s.generationBatchesMap[activeTopicId]);
};

// ====== aggregate selectors ====== //

export const generationBatchSelectors = {
  currentGenerationBatches,
  getGenerationBatchByBatchId,
  getGenerationBatchesByTopicId,
  isCurrentGenerationTopicLoaded,
};
