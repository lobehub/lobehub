import { type VideoStore } from '../../store';

const isCreating = (state: VideoStore) => state.isCreating;
const isCreatingWithNewTopic = (state: VideoStore) => state.isCreatingWithNewTopic;

export const createVideoSelectors = {
  isCreating,
  isCreatingWithNewTopic,
};
