import type { ImageGenerationTopic } from '@/types/generation';

export interface GenerationTopicState {
  activeGenerationTopicId: string | null;
  loadingGenerationTopicIds: string[];
  generationTopics: ImageGenerationTopic[];
}

export const initialGenerationTopicState: GenerationTopicState = {
  activeGenerationTopicId:
    typeof globalThis.window !== 'undefined'
      ? new URLSearchParams(globalThis.location.search).get('topic')
      : null,
  loadingGenerationTopicIds: [],
  generationTopics: [],
};
