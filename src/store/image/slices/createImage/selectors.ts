import { type ImageStore } from '../../store';

const blockedPrompt = (state: ImageStore) => state.blockedPrompt;
const isCreating = (state: ImageStore) => state.isCreating;
const isCreatingWithNewTopic = (state: ImageStore) => state.isCreatingWithNewTopic;

export const createImageSelectors = {
  blockedPrompt,
  isCreating,
  isCreatingWithNewTopic,
};
