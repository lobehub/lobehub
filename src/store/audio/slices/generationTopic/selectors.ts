import { type GenerationTopicState } from './initialState';

export const generationTopics = (s: GenerationTopicState) => s.generationTopics;
export const activeGenerationTopicId = (s: GenerationTopicState) => s.activeGenerationTopicId;
export const loadingGenerationTopicIds = (s: GenerationTopicState) => s.loadingGenerationTopicIds;

export const audioGenerationTopicSelectors = {
  generationTopics,
  activeGenerationTopicId,
  loadingGenerationTopicIds,
};
