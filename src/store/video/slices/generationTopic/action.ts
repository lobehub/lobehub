import { chainSummaryGenerationTitle } from '@lobechat/prompts';
import isEqual from 'fast-deep-equal';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { LOADING_FLAT } from '@/const/message';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { type UpdateTopicValue } from '@/server/routers/lambda/generationTopic';
import { chatService } from '@/services/chat';
import { generationTopicService } from '@/services/generationTopic';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { type ImageGenerationTopic } from '@/types/generation';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import type { VideoStore } from '../../store';
import { type GenerationTopicDispatch, generationTopicReducer } from './reducer';
import { generationTopicSelectors } from './selectors';

const FETCH_GENERATION_TOPICS_KEY = 'fetchVideoGenerationTopics';

const n = setNamespace('videoGenerationTopic');

export interface GenerationTopicAction {
  createGenerationTopic: (prompts: string[]) => Promise<string>;
  internal_createGenerationTopic: () => Promise<string>;
  internal_dispatchGenerationTopic: (payload: GenerationTopicDispatch, action?: any) => void;
  internal_removeGenerationTopic: (id: string) => Promise<void>;
  internal_updateGenerationTopic: (id: string, data: UpdateTopicValue) => Promise<void>;
  internal_updateGenerationTopicCover: (topicId: string, coverUrl: string) => Promise<void>;
  internal_updateGenerationTopicLoading: (id: string, loading: boolean) => void;
  internal_updateGenerationTopicTitleInSummary: (id: string, title: string) => void;

  openNewGenerationTopic: () => void;
  refreshGenerationTopics: () => Promise<void>;
  removeGenerationTopic: (id: string) => Promise<void>;
  summaryGenerationTopicTitle: (topicId: string, prompts: string[]) => Promise<string>;
  switchGenerationTopic: (topicId: string) => void;
  updateGenerationTopicCover: (topicId: string, imageUrl: string) => Promise<void>;
  useFetchGenerationTopics: (enabled: boolean) => SWRResponse<ImageGenerationTopic[]>;
}

export const createGenerationTopicSlice: StateCreator<
  VideoStore,
  [['zustand/devtools', never]],
  [],
  GenerationTopicAction
> = (set, get) => ({
  createGenerationTopic: async (prompts: string[]) => {
    if (!prompts || prompts.length === 0) {
      throw new Error('Prompts cannot be empty when creating a generation topic');
    }

    const { internal_createGenerationTopic, summaryGenerationTopicTitle } = get();

    const topicId = await internal_createGenerationTopic();

    summaryGenerationTopicTitle(topicId, prompts);

    return topicId;
  },

  internal_createGenerationTopic: async () => {
    const tmpId = Date.now().toString();

    get().internal_dispatchGenerationTopic(
      { type: 'addTopic', value: { id: tmpId, title: '' } },
      'internal_createGenerationTopic',
    );

    get().internal_updateGenerationTopicLoading(tmpId, true);

    const topicId = await generationTopicService.createTopic('video');
    get().internal_updateGenerationTopicLoading(tmpId, false);

    get().internal_updateGenerationTopicLoading(topicId, true);
    await get().refreshGenerationTopics();
    get().internal_updateGenerationTopicLoading(topicId, false);

    return topicId;
  },

  internal_dispatchGenerationTopic: (payload, action) => {
    const nextTopics = generationTopicReducer(get().generationTopics, payload);

    if (isEqual(nextTopics, get().generationTopics)) return;

    set(
      { generationTopics: nextTopics },
      false,
      action ?? n(`dispatchGenerationTopic/${payload.type}`),
    );
  },

  internal_removeGenerationTopic: async (id: string) => {
    get().internal_updateGenerationTopicLoading(id, true);
    try {
      await generationTopicService.deleteTopic(id);
      await get().refreshGenerationTopics();
    } finally {
      get().internal_updateGenerationTopicLoading(id, false);
    }
  },

  internal_updateGenerationTopic: async (id, data) => {
    get().internal_dispatchGenerationTopic({ id, type: 'updateTopic', value: data });

    get().internal_updateGenerationTopicLoading(id, true);

    await generationTopicService.updateTopic(id, data);

    await get().refreshGenerationTopics();
    get().internal_updateGenerationTopicLoading(id, false);
  },

  internal_updateGenerationTopicCover: async (topicId: string, coverUrl: string) => {
    const {
      internal_dispatchGenerationTopic,
      internal_updateGenerationTopicLoading,
      refreshGenerationTopics,
    } = get();

    internal_dispatchGenerationTopic(
      { id: topicId, type: 'updateTopic', value: { coverUrl } },
      'internal_updateGenerationTopicCover/optimistic',
    );

    internal_updateGenerationTopicLoading(topicId, true);

    try {
      await generationTopicService.updateTopicCover(topicId, coverUrl);

      await refreshGenerationTopics();
    } finally {
      internal_updateGenerationTopicLoading(topicId, false);
    }
  },

  internal_updateGenerationTopicLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) return { loadingGenerationTopicIds: [...state.loadingGenerationTopicIds, id] };

        return {
          loadingGenerationTopicIds: state.loadingGenerationTopicIds.filter((i) => i !== id),
        };
      },
      false,
      n('updateGenerationTopicLoading'),
    );
  },

  internal_updateGenerationTopicTitleInSummary: (id, title) => {
    get().internal_dispatchGenerationTopic(
      { id, type: 'updateTopic', value: { title } },
      'updateGenerationTopicTitleInSummary',
    );
  },

  openNewGenerationTopic: () => {
    set({ activeGenerationTopicId: null }, false, n('openNewGenerationTopic'));
  },

  refreshGenerationTopics: async () => {
    await mutate([FETCH_GENERATION_TOPICS_KEY]);
  },

  removeGenerationTopic: async (id: string) => {
    const {
      internal_removeGenerationTopic,
      generationTopics,
      activeGenerationTopicId,
      switchGenerationTopic,
      openNewGenerationTopic,
    } = get();

    const isRemovingActiveTopic = activeGenerationTopicId === id;
    let topicIndexToRemove = -1;

    if (isRemovingActiveTopic) {
      topicIndexToRemove = generationTopics.findIndex((topic) => topic.id === id);
    }

    await internal_removeGenerationTopic(id);

    if (isRemovingActiveTopic) {
      const newTopics = get().generationTopics;

      if (newTopics.length > 0) {
        const newActiveIndex = Math.min(topicIndexToRemove, newTopics.length - 1);
        const newActiveTopic = newTopics[newActiveIndex];

        if (newActiveTopic) {
          switchGenerationTopic(newActiveTopic.id);
        } else {
          openNewGenerationTopic();
        }
      } else {
        openNewGenerationTopic();
      }
    }
  },

  summaryGenerationTopicTitle: async (topicId: string, prompts: string[]) => {
    const topic = generationTopicSelectors.getGenerationTopicById(topicId)(get());
    if (!topic) throw new Error(`Topic ${topicId} not found`);

    const { internal_updateGenerationTopicTitleInSummary, internal_updateGenerationTopicLoading } =
      get();

    internal_updateGenerationTopicLoading(topicId, true);
    internal_updateGenerationTopicTitleInSummary(topicId, LOADING_FLAT);

    let output = '';

    const generateFallbackTitle = () => {
      const title = prompts[0]
        .replaceAll(/[^\s\w\u4E00-\u9FFF]/g, '')
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .join(' ')
        .slice(0, 20);

      return title;
    };

    const generationTopicAgentConfig = systemAgentSelectors.generationTopic(
      useUserStore.getState(),
    );
    await chatService.fetchPresetTaskResult({
      onError: async () => {
        const fallbackTitle = generateFallbackTitle();
        internal_updateGenerationTopicTitleInSummary(topicId, fallbackTitle);
        await get().internal_updateGenerationTopic(topicId, { title: fallbackTitle });
      },
      onFinish: async (text) => {
        await get().internal_updateGenerationTopic(topicId, { title: text });
      },
      onLoadingChange: (loading) => {
        internal_updateGenerationTopicLoading(topicId, loading);
      },
      onMessageHandle: (chunk) => {
        switch (chunk.type) {
          case 'text': {
            output += chunk.text;
            internal_updateGenerationTopicTitleInSummary(topicId, output);
          }
        }
      },
      params: merge(
        generationTopicAgentConfig,
        chainSummaryGenerationTitle(prompts, 'video', globalHelpers.getCurrentLanguage()),
      ),
    });

    return output;
  },

  switchGenerationTopic: (topicId: string) => {
    const currentTopics = get().generationTopics;
    const targetTopic = currentTopics.find((topic) => topic.id === topicId);

    if (!targetTopic) {
      console.warn(`Generation topic with id ${topicId} not found`);
      return;
    }

    if (get().activeGenerationTopicId === topicId) return;

    set({ activeGenerationTopicId: topicId }, false, n('switchGenerationTopic'));
  },

  updateGenerationTopicCover: async (topicId: string, coverUrl: string) => {
    const { internal_updateGenerationTopicCover } = get();
    await internal_updateGenerationTopicCover(topicId, coverUrl);
  },

  useFetchGenerationTopics: (enabled) =>
    useClientDataSWR<ImageGenerationTopic[]>(
      enabled ? [FETCH_GENERATION_TOPICS_KEY] : null,
      () => generationTopicService.getAllGenerationTopics('video'),
      {
        onSuccess: (data) => {
          if (isEqual(data, get().generationTopics)) return;
          set({ generationTopics: data }, false, n('useFetchGenerationTopics'));
        },
        suspense: true,
      },
    ),
});
