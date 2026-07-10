import { type ImageGenerationTopic } from '@/types/generation';

export type GenerationTopicVisibility = NonNullable<ImageGenerationTopic['visibility']>;

export interface GenerationTopicState {
  activeGenerationTopicId: string | null;
  loadingGenerationTopicIds: string[];
  generationTopics: ImageGenerationTopic[];
  newGenerationTopicVisibility: GenerationTopicVisibility;
}

export const initialGenerationTopicState: GenerationTopicState = {
  activeGenerationTopicId:
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('topic') : null,
  loadingGenerationTopicIds: [],
  generationTopics: [],
  newGenerationTopicVisibility: 'private',
};
