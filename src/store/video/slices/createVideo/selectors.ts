import { type VideoStore } from '../../store';

const editingGenerationId = (state: VideoStore) => state.editingGenerationId;
const isCreating = (state: VideoStore) => state.isCreating;
const isCreatingWithNewTopic = (state: VideoStore) => state.isCreatingWithNewTopic;

export const createVideoSelectors = {
  editingGenerationId,
  isCreating,
  isCreatingWithNewTopic,
};
