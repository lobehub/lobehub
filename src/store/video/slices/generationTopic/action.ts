import { chainSummaryGenerationTitle } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { LOADING_FLAT } from '@/const/message';
import { createReplicaSlice, type ReplicaLens, type ReplicaSyncResult } from '@/libs/replica';
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
import type { GenerationTopicVisibility } from './initialState';
import { GENERATION_TOPICS_KEY, generationTopicsResource } from './projection';
import { type GenerationTopicDispatch, generationTopicReducer } from './reducer';
import { generationTopicSelectors } from './selectors';

const n = setNamespace('videoGenerationTopic');

const TOPICS_PARAMS = {} as Record<string, never>;

/**
 * Result of the topic-list sync. `data` mirrors the SWR-era shape the shared
 * generation layout reads (`data !== undefined` marks the list as loaded at
 * least once, so an absent routed topic is a settled "not found"); the replica
 * flags are what the owner should use going forward.
 */
export interface GenerationTopicsSyncResult extends ReplicaSyncResult {
  data?: ImageGenerationTopic[];
  /** A request is in flight and the list has never loaded. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
}

/**
 * The topic list keeps its long-standing flat field (`generationTopics`) as the
 * replica view, gated by `isGenerationTopicsInit` so a loaded-but-empty list
 * stays distinguishable from one that was never fetched — and so `hydrate` is
 * not skipped by an always-array view.
 *
 * The cache scope (`${userId}:${workspaceId}`) owns the partition: a switch
 * clears the view before paint, so one identity's topics can never render under
 * another.
 */
const generationTopicsLens: ReplicaLens<VideoStore, ImageGenerationTopic[]> = {
  clear: () => ({ generationTopics: [], isGenerationTopicsInit: false }),
  get: (state) => (state.isGenerationTopicsInit ? state.generationTopics : undefined),
  keys: (state) => (state.isGenerationTopicsInit ? [GENERATION_TOPICS_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { generationTopics: data, isGenerationTopicsInit: true }
      : { generationTopics: [], isGenerationTopicsInit: false },
};

type Setter = StoreSetter<VideoStore>;

export const createGenerationTopicSlice = (set: Setter, get: () => VideoStore, _api?: unknown) =>
  new GenerationTopicActionImpl(set, get, _api);

export class GenerationTopicActionImpl {
  readonly #get: () => VideoStore;
  readonly #set: Setter;
  readonly #topics;

  constructor(set: Setter, get: () => VideoStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#topics = createReplicaSlice(generationTopicsResource, {
      actionPrefix: n('generationTopics'),
      fetcher: () => generationTopicService.getAllGenerationTopics('video'),
      get,
      // An unchanged list must not re-render the sidebar / command menu.
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'generationTopicsReplica',
      view: generationTopicsLens,
    });
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
    const { newGenerationTopicVisibility } = this.#get();

    // 1. Optimistic update - add temporary topic
    this.#get().internal_dispatchGenerationTopic({
      type: 'addTopic',
      value: { id: tmpId, title: '', visibility: newGenerationTopicVisibility },
    });

    this.#get().internal_updateGenerationTopicLoading(tmpId, true);

    const topicId = await generationTopicService.createTopic('video', newGenerationTopicVisibility);
    this.#get().internal_updateGenerationTopicLoading(tmpId, false);

    this.#get().internal_updateGenerationTopicLoading(topicId, true);
    await this.#get().refreshGenerationTopics();
    this.#get().internal_updateGenerationTopicLoading(topicId, false);

    return topicId;
  };

  setNewGenerationTopicVisibility = (visibility: GenerationTopicVisibility): void => {
    this.#set(
      { newGenerationTopicVisibility: visibility },
      false,
      n('setNewGenerationTopicVisibility'),
    );
  };

  /**
   * Optimistic write into the topic-list replica. Not persisted on its own: the
   * follow-up `refreshGenerationTopics` confirms the server value and persists
   * that, so a local placeholder never outlives the request that created it.
   */
  internal_dispatchGenerationTopic = (payload: GenerationTopicDispatch): void => {
    this.#topics.update(
      GENERATION_TOPICS_KEY,
      (topics) => generationTopicReducer(topics, payload),
      { persist: false },
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
    const { internal_dispatchGenerationTopic, internal_updateGenerationTopicLoading } = this.#get();

    // 1. Optimistic update - immediately show the new cover URL in UI
    internal_dispatchGenerationTopic({ type: 'updateTopic', id: topicId, value: { coverUrl } });

    // 2. Set loading state
    internal_updateGenerationTopicLoading(topicId, true);

    try {
      await generationTopicService.updateTopicCover(topicId, coverUrl);

      // 3. Refresh data to get the final processed cover URL from S3
      await this.#get().refreshGenerationTopics();
    } finally {
      // 4. Clear loading state
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
    this.#get().internal_dispatchGenerationTopic({ type: 'updateTopic', id, value: { title } });
  };

  openNewGenerationTopic = (): void => {
    this.#set(
      {
        activeGenerationTopicId: null,
        editingDraftSnapshot: undefined,
        editingGenerationId: undefined,
      },
      false,
      n('openNewGenerationTopic'),
    );
  };

  /**
   * Fetch orchestration for every surface that renders the topic list (sidebar,
   * routed workspace, command menu). The list is read through
   * `generationTopicSelectors`, not from this return value.
   */
  useFetchGenerationTopics = (enabled: boolean): GenerationTopicsSyncResult => {
    const sync = this.#topics.useSync(TOPICS_PARAMS, { enabled });
    const { generationTopics, isGenerationTopicsInit } = this.#get();

    return {
      data: isGenerationTopicsInit ? generationTopics : undefined,
      error: sync.error,
      isHydrated: sync.isHydrated,
      isLoading: sync.isValidating && !isGenerationTopicsInit,
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
      revalidate: sync.revalidate,
    };
  };

  refreshGenerationTopics = async (): Promise<void> => {
    await this.#topics.revalidate();
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
      trigger: RequestTrigger.GenerationTopicTitle,
    });

    return output;
  };

  switchGenerationTopic = (topicId: string): void => {
    if (this.#get().activeGenerationTopicId === topicId) return;

    this.#set(
      {
        activeGenerationTopicId: topicId,
        editingDraftSnapshot: undefined,
        editingGenerationId: undefined,
      },
      false,
      n('switchGenerationTopic'),
    );
  };

  updateGenerationTopicCover = async (topicId: string, coverUrl: string): Promise<void> => {
    const { internal_updateGenerationTopicCover } = this.#get();
    await internal_updateGenerationTopicCover(topicId, coverUrl);
  };
}

export type GenerationTopicAction = Pick<
  GenerationTopicActionImpl,
  keyof GenerationTopicActionImpl
>;
