import { type GenerationBatch } from '@/types/generation';

import { type MusicStoreState } from '../../initialState';
import { generationTopicSelectors } from '../generationTopic/selectors';

// ====== topic batch selectors ====== //

const getGenerationBatchesByTopicId = (topicId: string) => (s: MusicStoreState) => {
  return s.generationBatchesMap[topicId] || [];
};

const currentGenerationBatches = (s: MusicStoreState): GenerationBatch[] => {
  const activeTopicId = generationTopicSelectors.activeGenerationTopicId(s);
  if (!activeTopicId) return [];
  return getGenerationBatchesByTopicId(activeTopicId)(s);
};

const getGenerationBatchByBatchId = (batchId: string) => (s: MusicStoreState) => {
  const batches = currentGenerationBatches(s);
  return batches.find((batch) => batch.id === batchId);
};

const isCurrentGenerationTopicLoaded = (s: MusicStoreState): boolean => {
  const activeTopicId = generationTopicSelectors.activeGenerationTopicId(s);
  if (!activeTopicId) return false;
  // The batches replica removes the key when a topic leaves the view, so a
  // present array (even empty) is exactly "hydrated or server-confirmed".
  return Array.isArray(s.generationBatchesMap[activeTopicId]);
};

// ====== aggregate selectors ====== //

export const generationBatchSelectors = {
  currentGenerationBatches,
  getGenerationBatchByBatchId,
  getGenerationBatchesByTopicId,
  isCurrentGenerationTopicLoaded,
};
