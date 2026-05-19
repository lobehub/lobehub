import { setNamespace } from '@/utils/storeDebug';
import { type StoreSetter } from '@/store/types';
import { type GenerationTopicState } from './initialState';

const n = setNamespace('audioGenerationTopic');

export interface GenerationTopicAction {
  setActiveGenerationTopicId: (id: string | null) => void;
  setGenerationTopics: (topics: GenerationTopicState['generationTopics']) => void;
  setLoadingGenerationTopicIds: (ids: string[]) => void;
}

type Setter = StoreSetter<any>;

export const createGenerationTopicSlice = (set: Setter, get: () => any, _api?: unknown) => ({
  setActiveGenerationTopicId: (id: string | null) => {
    set({ activeGenerationTopicId: id }, false, n('setActiveGenerationTopicId'));
  },

  setGenerationTopics: (topics: GenerationTopicState['generationTopics']) => {
    set({ generationTopics: topics }, false, n('setGenerationTopics'));
  },

  setLoadingGenerationTopicIds: (ids: string[]) => {
    set({ loadingGenerationTopicIds: ids }, false, n('setLoadingGenerationTopicIds'));
  },
} as GenerationTopicAction);

export type { GenerationTopicAction };
