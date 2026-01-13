import { type ImageStore } from '../../store';

const isCreating = (state: ImageStore) => state.isCreating;
const isCreatingWithNewTopic = (state: ImageStore) => state.isCreatingWithNewTopic;

export const createImageSelectors = {
  isCreating,
  isCreatingWithNewTopic,
};
