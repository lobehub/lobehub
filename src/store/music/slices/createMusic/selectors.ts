import { type MusicStore } from '../../store';

const blockedPrompt = (state: MusicStore) => state.blockedPrompt;
const isCreating = (state: MusicStore) => state.isCreating;
const isCreatingWithNewTopic = (state: MusicStore) => state.isCreatingWithNewTopic;
const isRetryingBatch = (batchId: string) => (state: MusicStore) =>
  state.retryingBatchIds.includes(batchId);

export const createMusicSelectors = {
  blockedPrompt,
  isCreating,
  isCreatingWithNewTopic,
  isRetryingBatch,
};
