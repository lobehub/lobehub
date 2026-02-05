import type {ImageGenerationTopic} from '@/types/generation';

export interface GenerationTopicState {
  activeGenerationTopicId: string | null;
  loadingGenerationTopicIds: string[];
  generationTopics: ImageGenerationTopic[];
}

export const initialGenerationTopicState: GenerationTopicState = {
  activeGenerationTopicId:
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('topic') : null,
  loadingGenerationTopicIds: [],
  generationTopics: [],
};
