import { type MusicStoreState } from '../../initialState';

const activeGenerationTopicId = (s: MusicStoreState) => s.activeGenerationTopicId;
const generationTopics = (s: MusicStoreState) => s.generationTopics;
const getGenerationTopicById = (id: string) => (s: MusicStoreState) =>
  s.generationTopics.find((topic) => topic.id === id);
const isLoadingGenerationTopic = (id: string) => (s: MusicStoreState) =>
  s.loadingGenerationTopicIds.includes(id);
const newGenerationTopicVisibility = (s: MusicStoreState) => s.newGenerationTopicVisibility;

export const generationTopicSelectors = {
  activeGenerationTopicId,
  generationTopics,
  getGenerationTopicById,
  isLoadingGenerationTopic,
  newGenerationTopicVisibility,
};
