import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type ImageGenerationTopic } from '@/types/generation';

export type GenerationTopicVisibility = NonNullable<ImageGenerationTopic['visibility']>;

export interface GenerationTopicState {
  activeGenerationTopicId: string | null;
  loadingGenerationTopicIds: string[];
  /** Replica view of the topic list, one entry per cache scope (`generationTopicSelectors`). */
  generationTopics: ImageGenerationTopic[];
  /** Replica bookkeeping of `generationTopics`. */
  generationTopicsReplica: ReplicaState<ImageGenerationTopic[]>;
  /**
   * The topic list has been hydrated or server-confirmed at least once. An
   * absent topic is only a settled "not found" once this is true — before the
   * first load the routed topic is merely not painted yet.
   */
  isGenerationTopicsInit: boolean;
  newGenerationTopicVisibility: GenerationTopicVisibility;
}

export const initialGenerationTopicState: GenerationTopicState = {
  activeGenerationTopicId:
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('topic') : null,
  loadingGenerationTopicIds: [],
  generationTopics: [],
  generationTopicsReplica: createReplicaState(),
  isGenerationTopicsInit: false,
  newGenerationTopicVisibility: 'private',
};
