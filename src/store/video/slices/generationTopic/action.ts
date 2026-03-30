import { chainSummaryGenerationTitle } from '@lobechat/prompts';
import isEqual from 'fast-deep-equal';
import type { SWRResponse } from 'swr';

import { LOADING_FLAT } from '@/const/message';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { type UpdateTopicValue } from '@/server/routers/lambda/generationTopic';
import { chatService } from '@/services/chat';
import { generationTopicService } from '@/services/generationTopic';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';
import { type ImageGenerationTopic } from '@/types/generation';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import type { VideoStore } from '../../store';
import { type GenerationTopicDispatch, generationTopicReducer } from './reducer';
import { generationTopicSelectors } from './selectors';

const FETCH_GENERATION_TOPICS_KEY = 'fetchVideoGenerationTopics';

const n = setNamespace('videoGenerationTopic');

type Setter = StoreSetter<VideoStore>;

export const createGenerationTopicSlice = (set: Setter, get: () => VideoStore, _api?: unknown) =>
  new GenerationTopicActionImpl(set, get, _api);

export class GenerationTopicActionImpl {
  readonly #get: () => VideoStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => VideoStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createGenerationTopic = async (prompts: string[]): Promise<string> => {
    if (!prompts || prompts.length === 0) {
      throw new Error('Prompts cannot be empty when creating a generation topic');
    }

    const { internal_createGenerationTopic, summaryGenerationTopicTitle } = this.#get();

    const topicId = await internal_createGenerationTopic();

    summaryGenerationTopicTitle(topicId, prompts);

    return topicId;
  };

  internal_createGenerationTopic = async (): Promise<string> => {
    const tmpId = Date.now().toString();

    this.#get().internal_dispatchGenerationTopic(
      { type: 'addTopic', value: { id: tmpId, title: '' } },
      'internal_createGenerationTopic',
    );

    this.#get().internal_updateGenerationTopicLoading(tmpId, true);

    const topicId = await generationTopicService.createTopic('video');
    this.#get().internal_updateGenerationTopicLoading(tmpId, false);

    this.#get().internal_updateGenerationTopicLoading(topicId, true);
    await this.#get().refreshGenerationTopics();
    this.#get().internal_updateGenerationTopicLoading(topicId, false);

    return topicId;
  };

  internal_dispatchGenerationTopic = (payload: GenerationTopicDispatch, action?: any): void => {
    const nextTopics = generationTopicReducer(this.#get().generationTopics, payload);

    if (isEqual(nextTopics, this.#get().generationTopics)) return;

    this.#set(
      { generationTopics: nextTopics },
      false,
      action ?? n(`dispatchGenerationTopic/${payload.type}`),
    );
  };

  internal_removeGenerationTopic = async (id: string): Promise<void> => {
    this.#get().internal_updateGenerationTopicLoading(id, true);
    try {
      await generationTopicService.deleteTopic(id);
      await this.#get().refreshGenerationTopics();
    } finally {
      this.#get().internal_updateGenerationTopicLoading(id, false);
    }
  };

  internal_updateGenerationTopic = async (id: string, data: UpdateTopicValue): Promise<void> => {
    this.#get().internal_dispatchGenerationTopic({ id, type: 'updateTopic', value: data });

    this.#get().internal_updateGenerationTopicLoading(id, true);

    await generationTopicService.updateTopic(id, data);

    await this.#get().refreshGenerationTopics();
    this.#get().internal_updateGenerationTopicLoading(id, false);
  };

  internal_updateGenerationTopicCover = async (
    topicId: string,
    coverUrl: string,
  ): Promise<void> => {
    const {
      internal_dispatchGenerationTopic,
      internal_updateGenerationTopicLoading,
      refreshGenerationTopics,
    } = this.#get();

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
  };

  internal_updateGenerationTopicLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) return { loadingGenerationTopicIds: [...state.loadingGenerationTopicIds, id] };

        return {
          loadingGenerationTopicIds: state.loadingGenerationTopicIds.filter((i) => i !== id),
        };
      },
      false,
      n('updateGenerationTopicLoading'),
    );
  };

  internal_updateGenerationTopicTitleInSummary = (id: string, title: string): void => {
    this.#get().internal_dispatchGenerationTopic(
      { id, type: 'updateTopic', value: { title } },
      'updateGenerationTopicTitleInSummary',
    );
  };

  openNewGenerationTopic = (): void => {
    this.#set({ activeGenerationTopicId: null }, false, n('openNewGenerationTopic'));
  };

  refreshGenerationTopics = async (): Promise<void> => {
    await mutate([FETCH_GENERATION_TOPICS_KEY]);
  };

  removeGenerationTopic = async (id: string): Promise<void> => {
    const {
      internal_removeGenerationTopic,
      generationTopics,
      activeGenerationTopicId,
      switchGenerationTopic,
      openNewGenerationTopic,
    } = this.#get();

    const isRemovingActiveTopic = activeGenerationTopicId === id;
    let topicIndexToRemove = -1;

    if (isRemovingActiveTopic) {
      topicIndexToRemove = generationTopics.findIndex((topic) => topic.id === id);
    }

    await internal_removeGenerationTopic(id);

    if (isRemovingActiveTopic) {
      const newTopics = this.#get().generationTopics;

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
  };

  summaryGenerationTopicTitle = async (topicId: string, prompts: string[]): Promise<string> => {
    const topic = generationTopicSelectors.getGenerationTopicById(topicId)(this.#get());
    if (!topic) throw new Error(`Topic ${topicId} not found`);

    const { internal_updateGenerationTopicTitleInSummary, internal_updateGenerationTopicLoading } =
      this.#get();

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
        await this.#get().internal_updateGenerationTopic(topicId, { title: fallbackTitle });
      },
      onFinish: async (text) => {
        await this.#get().internal_updateGenerationTopic(topicId, { title: text });
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
        chainSummaryGenerationTitle(
          prompts,
          'video',
          userGeneralSettingsSelectors.currentResponseLanguage(useUserStore.getState()),
        ),
      ),
    });

    return output;
  };

  switchGenerationTopic = (topicId: string): void => {
    if (this.#get().activeGenerationTopicId === topicId) return;

    this.#set({ activeGenerationTopicId: topicId }, false, n('switchGenerationTopic'));
  };

  updateGenerationTopicCover = async (topicId: string, coverUrl: string): Promise<void> => {
    const { internal_updateGenerationTopicCover } = this.#get();
    await internal_updateGenerationTopicCover(topicId, coverUrl);
  };

  useFetchGenerationTopics = (enabled: boolean): SWRResponse<ImageGenerationTopic[]> =>
    useClientDataSWR<ImageGenerationTopic[]>(
      enabled ? [FETCH_GENERATION_TOPICS_KEY] : null,
      () => generationTopicService.getAllGenerationTopics('video'),
      {
        onSuccess: (data) => {
          if (isEqual(data, this.#get().generationTopics)) return;
          this.#set({ generationTopics: data }, false, n('useFetchGenerationTopics'));
        },
        suspense: true,
      },
    );
}

export type GenerationTopicAction = Pick<
  GenerationTopicActionImpl,
  keyof GenerationTopicActionImpl
>;
