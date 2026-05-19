export interface GenerationTopicState {
  activeGenerationTopicId: string | null;
  generationTopics: Array<{ id: string; title?: string; coverUrl?: string; createdAt?: Date; updatedAt?: Date }>;
  loadingGenerationTopicIds: string[];
}

export const initialGenerationTopicState: GenerationTopicState = {
  activeGenerationTopicId:
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('topic') : null,
  generationTopics: [],
  loadingGenerationTopicIds: [],
};
