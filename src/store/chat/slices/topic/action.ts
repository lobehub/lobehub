/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Note: To make the code more logic and readable, we just disable the auto sort key eslint rule
// DON'T REMOVE THE FIRST LINE
import { chainSummaryTitle } from '@lobechat/prompts';
import {
  type ChatTopicMetadata,
  type MessageMapScope,
  TraceNameMap,
  type UIChatMessage,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import useSWR, { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { message } from '@/components/AntdStaticMethods';
import { LOADING_FLAT } from '@/const/message';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import type { ChatStore } from '@/store/chat';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useGlobalStore } from '@/store/global';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { type ChatTopic, type CreateTopicParams } from '@/types/topic';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { displayMessageSelectors } from '../message/selectors';
import { type TopicData } from './initialState';
import { type ChatTopicDispatch, topicReducer } from './reducer';
import { topicSelectors } from './selectors';

const n = setNamespace('t');

const SWR_USE_FETCH_TOPIC = 'SWR_USE_FETCH_TOPIC';
const SWR_USE_SEARCH_TOPIC = 'SWR_USE_SEARCH_TOPIC';
type CronTopicsGroupWithJobInfo = {
  cronJob: unknown;
  cronJobId: string;
  topics: ChatTopic[];
};

/**
 * Options for switchTopic action
 */
export interface SwitchTopicOptions {
  /**
   * Clear the _new key data even when switching to an existing topic
   * This is useful when creating a new topic, where the _new key data should be cleared
   * @default false
   */
  clearNewKey?: boolean;
  /**
   * Explicit scope for clearing new key data
   * If not provided, will be inferred from store state (activeGroupId)
   */
  scope?: MessageMapScope;
  /**
   * Skip refreshing messages after switching topic
   * @default false
   */
  skipRefreshMessage?: boolean;
}

export interface ChatTopicAction {
  closeAllTopicsDrawer: () => void;
  favoriteTopic: (id: string, favState: boolean) => Promise<void>;
  importTopic: (data: string) => Promise<string | undefined>;
  loadMoreTopics: () => Promise<void>;
  openAllTopicsDrawer: () => void;
  openNewTopicOrSaveTopic: () => Promise<void>;
  refreshTopic: () => Promise<void>;
  removeAllTopics: () => Promise<void>;
  removeSessionTopics: () => Promise<void>;
  removeGroupTopics: (groupId: string) => Promise<void>;
  removeTopic: (id: string) => Promise<void>;
  removeUnstarredTopic: () => Promise<void>;
  saveToTopic: (sessionId?: string) => Promise<string | undefined>;
  createTopic: (sessionId?: string) => Promise<string | undefined>;

  autoRenameTopicTitle: (id: string) => Promise<void>;
  duplicateTopic: (id: string) => Promise<void>;
  summaryTopicTitle: (topicId: string, messages: UIChatMessage[]) => Promise<void>;
  /**
   * Switch to a topic or create new topic state
   * @param id - Topic ID to switch to, or null to switch to "new" state (clears _new key data)
   * @param options - Options object for configuring the switch behavior
   */
  switchTopic: (id?: string | null, options?: SwitchTopicOptions) => Promise<void>;
  /**
   * Update topic metadata
   * @param id - Topic ID to update
   * @param metadata - Partial metadata to merge with existing metadata
   */
  updateTopicMetadata: (id: string, metadata: Partial<ChatTopicMetadata>) => Promise<void>;
  updateTopicTitle: (id: string, title: string) => Promise<void>;
  useFetchTopics: (
    enable: boolean,
    params: {
      agentId?: string;
      excludeTriggers?: string[];
      groupId?: string;
      isInbox?: boolean;
      pageSize?: number;
    },
  ) => SWRResponse<{ items: ChatTopic[]; total: number }>;
  useSearchTopics: (
    keywords: string | undefined,
    params: {
      agentId?: string;
      groupId?: string;
    },
  ) => SWRResponse<ChatTopic[]>;

  internal_updateTopicTitleInSummary: (id: string, title: string) => void;
  internal_updateTopicLoading: (id: string, loading: boolean) => void;
  internal_createTopic: (params: CreateTopicParams) => Promise<string>;
  internal_updateTopic: (id: string, data: Partial<ChatTopic>) => Promise<void>;
  internal_dispatchTopic: (payload: ChatTopicDispatch, action?: any) => void;
  internal_updateTopics: (
    agentId: string,
    params: {
      append?: boolean;
      currentPage?: number;
      groupId?: string;
      items: ChatTopic[];
      pageSize: number;
      total: number;
    },
  ) => void;
  /**
   * Update TopicData properties (loading states, pagination, etc.)
   */
  internal_updateTopicData: (key: string, data: Partial<TopicData>) => void;
}

export const chatTopic: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatTopicAction
> = (set, get) => ({
  closeAllTopicsDrawer: () => {
    set({ allTopicsDrawerOpen: false }, false, n('closeAllTopicsDrawer'));
  },

  openAllTopicsDrawer: () => {
    set({ allTopicsDrawerOpen: true }, false, n('openAllTopicsDrawer'));
  },

  // create
  openNewTopicOrSaveTopic: async () => {
    const { switchTopic, saveToTopic, refreshMessages, activeTopicId } = get();
    const hasTopic = !!activeTopicId;

    if (hasTopic) switchTopic(null);
    else {
      await saveToTopic();
      refreshMessages();
    }
  },

  createTopic: async (sessionId) => {
    const { activeAgentId, internal_createTopic } = get();

    const messages = displayMessageSelectors.activeDisplayMessages(get());

    set({ creatingTopic: true }, false, n('creatingTopic/start'));
    const topicId = await internal_createTopic({
      title: t('defaultTitle', { ns: 'topic' }),
      messages: messages.map((m) => m.id),
      sessionId: sessionId || activeAgentId,
    });
    set({ creatingTopic: false }, false, n('creatingTopic/end'));

    return topicId;
  },

  saveToTopic: async (sessionId) => {
    // if there is no message, stop
    const messages = displayMessageSelectors.activeDisplayMessages(get());
    if (messages.length === 0) return;

    const { activeAgentId, summaryTopicTitle, internal_createTopic } = get();

    // 1. create topic and bind these messages
    const topicId = await internal_createTopic({
      title: t('defaultTitle', { ns: 'topic' }),
      messages: messages.map((m) => m.id),
      sessionId: sessionId || activeAgentId,
    });

    get().internal_updateTopicLoading(topicId, true);
    // 2. auto summary topic Title
    // we don't need to wait for summary, just let it run async
    summaryTopicTitle(topicId, messages);

    return topicId;
  },

  duplicateTopic: async (id) => {
    const { refreshTopic, switchTopic } = get();

    const topic = topicSelectors.getTopicById(id)(get());
    if (!topic) return;

    const newTitle = t('duplicateTitle', { ns: 'chat', title: topic?.title });

    message.loading({
      content: t('duplicateLoading', { ns: 'topic' }),
      key: 'duplicateTopic',
      duration: 0,
    });

    const newTopicId = await topicService.cloneTopic(id, newTitle);
    await refreshTopic();
    message.destroy('duplicateTopic');
    message.success(t('duplicateSuccess', { ns: 'topic' }));

    await switchTopic(newTopicId);
  },

  importTopic: async (data) => {
    const { activeAgentId, activeGroupId, refreshTopic, switchTopic } = get();

    if (!activeAgentId) return;

    message.loading({
      content: t('importLoading', { ns: 'topic' }),
      duration: 0,
      key: 'importTopic',
    });

    try {
      const result = await topicService.importTopic({
        agentId: activeAgentId,
        data,
        groupId: activeGroupId,
      });

      await refreshTopic();
      message.destroy('importTopic');
      message.success(t('importSuccess', { count: result.messageCount, ns: 'topic' }));

      await switchTopic(result.topicId);

      return result.topicId;
    } catch (error) {
      message.destroy('importTopic');
      message.error(t('importError', { ns: 'topic' }));
      console.error('[importTopic] Failed:', error);
      return undefined;
    }
  },
  // update
  summaryTopicTitle: async (topicId, messages) => {
    const { internal_updateTopicTitleInSummary, internal_updateTopicLoading } = get();
    const topic = topicSelectors.getTopicById(topicId)(get());
    if (!topic) return;

    internal_updateTopicTitleInSummary(topicId, LOADING_FLAT);

    let output = '';

    // Get current agent for topic
    const topicConfig = systemAgentSelectors.topic(useUserStore.getState());

    // Automatically summarize the topic title
    await chatService.fetchPresetTaskResult({
      onError: () => {
        internal_updateTopicTitleInSummary(topicId, topic.title);
      },
      onFinish: async (text) => {
        await get().internal_updateTopic(topicId, { title: text });
      },
      onLoadingChange: (loading) => {
        internal_updateTopicLoading(topicId, loading);
      },
      onMessageHandle: (chunk) => {
        switch (chunk.type) {
          case 'text': {
            output += chunk.text;
          }
        }

        internal_updateTopicTitleInSummary(topicId, output);
      },
      params: merge(topicConfig, chainSummaryTitle(messages, globalHelpers.getCurrentLanguage())),
      trace: get().getCurrentTracePayload({ traceName: TraceNameMap.SummaryTopicTitle, topicId }),
    });
  },
  favoriteTopic: async (id, favorite) => {
    const { activeAgentId } = get();
    await get().internal_updateTopic(id, { favorite });

    if (!activeAgentId) return;

    await mutate(
      ['cronTopicsWithJobInfo', activeAgentId],
      (groups?: CronTopicsGroupWithJobInfo[]) => {
        if (!Array.isArray(groups)) return groups;

        let updated = false;
        const next = groups.map((group) => {
          let groupUpdated = false;
          const topics = Array.isArray(group.topics)
            ? group.topics.map((topic) => {
                if (topic.id !== id) return topic;
                if (topic.favorite === favorite) return topic;
                groupUpdated = true;
                updated = true;
                return { ...topic, favorite };
              })
            : [];

          return groupUpdated ? { ...group, topics } : group;
        });

        return updated ? next : groups;
      },
      { revalidate: false },
    );
  },

  updateTopicMetadata: async (id, metadata) => {
    const topic = topicSelectors.getTopicById(id)(get());
    if (!topic) return;

    // Optimistic update with merged metadata
    const mergedMetadata = { ...topic.metadata, ...metadata };
    get().internal_dispatchTopic({ type: 'updateTopic', id, value: { metadata: mergedMetadata } });

    get().internal_updateTopicLoading(id, true);
    await topicService.updateTopicMetadata(id, metadata);
    await get().refreshTopic();
    get().internal_updateTopicLoading(id, false);
  },

  updateTopicTitle: async (id, title) => {
    await get().internal_updateTopic(id, { title });
  },

  autoRenameTopicTitle: async (id) => {
    const { activeAgentId: agentId, summaryTopicTitle, internal_updateTopicLoading } = get();

    internal_updateTopicLoading(id, true);
    const messages = await messageService.getMessages({ agentId, topicId: id });

    await summaryTopicTitle(id, messages);
    internal_updateTopicLoading(id, false);
  },

  // query
  useFetchTopics: (
    enable,
    { agentId, excludeTriggers, groupId, pageSize: customPageSize, isInbox },
  ) => {
    const pageSize = customPageSize || 20;
    const effectiveExcludeTriggers =
      excludeTriggers && excludeTriggers.length > 0 ? excludeTriggers : undefined;
    // Use topicMapKey to generate the container key for topic data map
    const containerKey = topicMapKey({ agentId, groupId });
    const hasValidContainer = !!(groupId || agentId);

    return useClientDataSWRWithSync<{ items: ChatTopic[]; total: number }>(
      enable && hasValidContainer
        ? [
            SWR_USE_FETCH_TOPIC,
            containerKey,
            {
              isInbox,
              pageSize,
              ...(effectiveExcludeTriggers ? { excludeTriggers: effectiveExcludeTriggers } : {}),
            },
          ]
        : null,
      async () => {
        // agentId, groupId, isInbox, pageSize come from the outer scope closure
        if (!agentId && !groupId) return { items: [], total: 0 };

        const currentData = get().topicDataMap[containerKey];
        const lastPageSize = currentData?.pageSize;
        const hasExistingItems = (currentData?.items?.length || 0) > 0;

        // Only treat as "expanding page size" when user actually increases pageSize,
        // not when SWR revalidates or when total items < pageSize.
        const isExpanding =
          hasExistingItems && typeof lastPageSize === 'number' && pageSize > lastPageSize;
        if (isExpanding) {
          get().internal_updateTopicData(containerKey, { isExpandingPageSize: true });
        }

        const result = await topicService.getTopics({
          agentId,
          current: 0,
          excludeTriggers: effectiveExcludeTriggers,
          groupId,
          isInbox,
          pageSize,
        });

        // Reset expanding state after fetch completes
        if (isExpanding) {
          get().internal_updateTopicData(containerKey, { isExpandingPageSize: false });
        }

        return result;
      },
      {
        // onData: responsible for state updates (fires for both cached and fresh data)
        onData: (result) => {
          if (!hasValidContainer) return;

          const { items: topics, total: totalCount } = result;
          const hasMore = topics.length >= pageSize;

          const currentData = get().topicDataMap[containerKey];

          // no need to update map if the current key's data exists and is the same
          if (currentData && isEqual(topics, currentData.items)) return;

          set(
            {
              topicDataMap: {
                ...get().topicDataMap,
                [containerKey]: {
                  currentPage: 0,
                  excludeTriggers: effectiveExcludeTriggers,
                  hasMore,
                  isExpandingPageSize: false,
                  items: topics,
                  pageSize,
                  total: totalCount,
                },
              },
            },
            false,
            n('useFetchTopics(onData)', { containerKey }),
          );
        },
      },
    );
  },

  loadMoreTopics: async () => {
    const { activeAgentId, activeGroupId, topicDataMap } = get();
    const key = topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    const currentData = topicDataMap[key];

    if ((!activeAgentId && !activeGroupId) || currentData?.isLoadingMore) return;

    const currentPage = currentData?.currentPage || 0;
    const nextPage = currentPage + 1;

    set(
      {
        topicDataMap: {
          ...topicDataMap,
          [key]: { ...currentData!, isLoadingMore: true },
        },
      },
      false,
      n('loadMoreTopics(start)'),
    );

    try {
      const pageSize = useGlobalStore.getState().status.topicPageSize || 20;
      const excludeTriggers = currentData?.excludeTriggers;
      const result = await topicService.getTopics({
        agentId: activeAgentId,
        current: nextPage,
        excludeTriggers,
        groupId: activeGroupId,
        pageSize,
      });

      const currentTopics = currentData?.items || [];
      const hasMore = result.items.length >= pageSize;

      set(
        {
          topicDataMap: {
            ...get().topicDataMap,
            [key]: {
              currentPage: nextPage,
              excludeTriggers,
              hasMore,
              isLoadingMore: false,
              items: [...currentTopics, ...result.items],
              pageSize,
              total: result.total,
            },
          },
        },
        false,
        n('loadMoreTopics(success)'),
      );
    } catch {
      set(
        {
          topicDataMap: {
            ...get().topicDataMap,
            [key]: { ...get().topicDataMap[key]!, isLoadingMore: false },
          },
        },
        false,
        n('loadMoreTopics(error)'),
      );
    }
  },
  useSearchTopics: (keywords, { agentId, groupId }) =>
    useSWR<ChatTopic[]>(
      keywords ? [SWR_USE_SEARCH_TOPIC, keywords, agentId, groupId] : null,
      ([, keywords, agentId, groupId]: [string, string, string | undefined, string | undefined]) =>
        topicService.searchTopics(keywords, agentId, groupId),
      {
        onSuccess: (data) => {
          set(
            { searchTopics: data, isSearchingTopic: false },
            false,
            n('useSearchTopics(success)', { keywords }),
          );
        },
      },
    ),

  switchTopic: async (id, options) => {
    const opts = options ?? {};

    const { activeAgentId, activeGroupId } = get();

    // Clear the _new key data in the following cases:
    // 1. When id is null or undefined (switching to empty topic state)
    // 2. When clearNewKey option is explicitly true
    // This prevents stale data from previous conversations showing up
    // Note: Use == null to match both null and undefined
    const shouldClearNewKey = !id || opts.clearNewKey;

    if (shouldClearNewKey && activeAgentId) {
      // Determine scope: use explicit scope from options, or infer from activeGroupId
      const scope = opts.scope ?? (activeGroupId ? 'group' : 'main');

      get().replaceMessages([], {
        context: {
          agentId: activeAgentId,
          groupId: activeGroupId,
          scope,
          topicId: null,
        },
        action: n('clearNewKeyData'),
      });
    }

    set(
      { activeTopicId: !id ? (null as any) : id, activeThreadId: undefined },
      false,
      n('toggleTopic'),
    );

    if (opts.skipRefreshMessage) return;
    await get().refreshMessages();
  },
  // delete
  removeSessionTopics: async () => {
    const { switchTopic, activeAgentId, refreshTopic } = get();
    if (!activeAgentId) return;

    await topicService.removeTopicsByAgentId(activeAgentId);
    await refreshTopic();

    // switch to default topic
    switchTopic(null);
  },

  removeGroupTopics: async (groupId: string) => {
    const { switchTopic, refreshTopic } = get();

    // Get topics for this specific group from the topic map using topicMapKey
    const key = topicMapKey({ groupId });
    const groupTopics = get().topicDataMap[key]?.items || [];
    const topicIds = groupTopics.map((t) => t.id);

    if (topicIds.length > 0) {
      await topicService.batchRemoveTopics(topicIds);
    }

    await refreshTopic();

    // switch to default topic
    switchTopic(null);
  },
  removeAllTopics: async () => {
    const { refreshTopic } = get();

    await topicService.removeAllTopic();
    await refreshTopic();
  },
  removeTopic: async (id) => {
    const { activeAgentId, activeGroupId, activeTopicId, switchTopic, refreshTopic } = get();
    // Allow deletion when either agentId or groupId is active
    if (!activeAgentId && !activeGroupId) return;

    // remove topic
    await topicService.removeTopic(id);
    await refreshTopic();

    // switch back to default topic
    if (activeTopicId === id) switchTopic(null);
  },
  removeUnstarredTopic: async () => {
    const { refreshTopic, switchTopic } = get();
    const topics = topicSelectors.currentUnFavTopics(get());

    await topicService.batchRemoveTopics(topics.map((t) => t.id));
    await refreshTopic();

    // Switch to default topic
    switchTopic(null);
  },

  // Internal process method of the topics
  internal_updateTopicTitleInSummary: (id, title) => {
    get().internal_dispatchTopic(
      { type: 'updateTopic', id, value: { title } },
      'updateTopicTitleInSummary',
    );
  },
  refreshTopic: async () => {
    const { activeAgentId, activeGroupId } = get();
    // Use topicMapKey to generate the same key used in useFetchTopics
    // Key format: [SWR_USE_FETCH_TOPIC, containerKey, { isInbox, pageSize }]
    const containerKey = topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    await mutate(
      (key) => Array.isArray(key) && key[0] === SWR_USE_FETCH_TOPIC && key[1] === containerKey,
    );
  },

  internal_updateTopicLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) return { topicLoadingIds: [...state.topicLoadingIds, id] };

        return { topicLoadingIds: state.topicLoadingIds.filter((i) => i !== id) };
      },
      false,
      n('updateTopicLoading'),
    );
  },

  internal_updateTopic: async (id, data) => {
    get().internal_dispatchTopic({ type: 'updateTopic', id, value: data });

    get().internal_updateTopicLoading(id, true);
    await topicService.updateTopic(id, data);
    await get().refreshTopic();
    get().internal_updateTopicLoading(id, false);
  },
  internal_createTopic: async (params) => {
    const tmpId = Date.now().toString();
    get().internal_dispatchTopic(
      { type: 'addTopic', value: { ...params, id: tmpId } },
      'internal_createTopic',
    );

    get().internal_updateTopicLoading(tmpId, true);
    const topicId = await topicService.createTopic(params);
    get().internal_updateTopicLoading(tmpId, false);

    get().internal_updateTopicLoading(topicId, true);
    await get().refreshTopic();
    get().internal_updateTopicLoading(topicId, false);

    return topicId;
  },

  internal_dispatchTopic: (payload, action) => {
    const { activeAgentId, activeGroupId } = get();
    const key = topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    const currentData = get().topicDataMap[key];
    const nextItems = topicReducer(currentData?.items, payload);

    // no need to update if is the same
    if (isEqual(nextItems, currentData?.items)) return;

    set(
      {
        topicDataMap: {
          ...get().topicDataMap,
          [key]: {
            ...currentData,
            currentPage: currentData?.currentPage ?? 0,
            hasMore: currentData?.hasMore ?? false,
            items: nextItems,
            total: currentData?.total ?? nextItems.length,
          },
        },
      },
      false,
      action ?? n(`dispatchTopic/${payload.type}`),
    );
  },

  internal_updateTopics: (agentId, params) => {
    const { items, total, pageSize, currentPage = 0, append = false, groupId } = params;
    const key = topicMapKey({ agentId, groupId });
    const currentData = get().topicDataMap[key];

    const nextItems = append ? [...(currentData?.items || []), ...items] : items;

    set(
      {
        topicDataMap: {
          ...get().topicDataMap,
          [key]: {
            currentPage,
            hasMore: items.length >= pageSize,
            isExpandingPageSize: false,
            isLoadingMore: false,
            items: nextItems,
            pageSize,
            total,
          },
        },
      },
      false,
      n('internal_updateTopics', { key, append }),
    );
  },

  internal_updateTopicData: (key, data) => {
    const currentData = get().topicDataMap[key];
    if (!currentData) return;

    set(
      {
        topicDataMap: {
          ...get().topicDataMap,
          [key]: {
            ...currentData,
            ...data,
          },
        },
      },
      false,
      n('internal_updateTopicData', { key, data }),
    );
  },
});
