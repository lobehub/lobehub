import { type VideoStore } from '../../store';

const blockedPrompt = (state: VideoStore) => state.blockedPrompt;
const editingGenerationId = (state: VideoStore) => state.editingGenerationId;
const isCreating = (state: VideoStore) => state.isCreating;
const isCreatingWithNewTopic = (state: VideoStore) => state.isCreatingWithNewTopic;

export const createVideoSelectors = {
  blockedPrompt,
  editingGenerationId,
  isCreating,
  isCreatingWithNewTopic,
};
