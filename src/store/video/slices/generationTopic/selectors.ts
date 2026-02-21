import { type VideoStoreState } from '../../initialState';

const activeGenerationTopicId = (s: VideoStoreState) => s.activeGenerationTopicId;
const generationTopics = (s: VideoStoreState) => s.generationTopics;
const getGenerationTopicById = (id: string) => (s: VideoStoreState) =>
  s.generationTopics.find((topic) => topic.id === id);
const isLoadingGenerationTopic = (id: string) => (s: VideoStoreState) =>
  s.loadingGenerationTopicIds.includes(id);

export const generationTopicSelectors = {
  activeGenerationTopicId,
  generationTopics,
  getGenerationTopicById,
  isLoadingGenerationTopic,
};
