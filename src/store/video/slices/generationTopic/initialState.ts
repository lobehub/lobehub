import { type ImageGenerationTopic } from '@/types/generation';

export interface GenerationTopicState {
  activeGenerationTopicId: string | null;
  generationTopics: ImageGenerationTopic[];
  loadingGenerationTopicIds: string[];
}

export const initialGenerationTopicState: GenerationTopicState = {
  activeGenerationTopicId:
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('topic') : null,
  generationTopics: [],
  loadingGenerationTopicIds: [],
};
