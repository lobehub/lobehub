'use client';

import { createContext, useContext } from 'react';
import type { SWRResponse } from 'swr';
import type { StoreApi, UseBoundStore } from 'zustand';

import { type ImageGenerationTopic } from '@/types/generation';

export interface GenerationTopicStoreSlice {
  activeGenerationTopicId: string | null;
  generationTopics: ImageGenerationTopic[];
  loadingGenerationTopicIds: string[];
  openNewGenerationTopic: () => void;
  removeGenerationTopic: (id: string) => Promise<void>;
  switchGenerationTopic: (topicId: string) => void;
  useFetchGenerationTopics: (enabled: boolean) => SWRResponse<ImageGenerationTopic[]>;
}

export interface GenerationTopicContextValue {
  /** i18n namespace */
  namespace: 'image' | 'video';
  useStore: UseBoundStore<StoreApi<GenerationTopicStoreSlice>>;
}

const GenerationTopicContext = createContext<GenerationTopicContextValue | null>(null);

export const useGenerationTopicContext = () => {
  const ctx = useContext(GenerationTopicContext);
  if (!ctx) {
    throw new Error('useGenerationTopicContext must be used within GenerationTopicStoreProvider');
  }
  return ctx;
};

export const GenerationTopicStoreProvider = GenerationTopicContext.Provider;
