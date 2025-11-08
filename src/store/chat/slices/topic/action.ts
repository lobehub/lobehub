/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Note: To make the code more logic and readable, we just disable the auto sort key eslint rule
// DON'T REMOVE THE FIRST LINE
import { chainSummaryTitle } from '@lobechat/prompts';
import { TraceNameMap, UIChatMessage } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { produce } from 'immer';
import useSWR, { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { message } from '@/components/AntdStaticMethods';
import { LOADING_FLAT } from '@/const/message';
import { useClientDataSWR } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { CreateTopicParams } from '@/services/topic/type';
import type { ChatStore } from '@/store/chat';
import type { ChatStoreState } from '@/store/chat/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { globalHelpers } from '@/store/global/helpers';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { ChatTopic } from '@/types/topic';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { chatSelectors } from '../message/selectors';
import { ChatTopicDispatch, topicReducer } from './reducer';
import { topicSelectors } from './selectors';

const n = setNamespace('t');

const SWR_USE_FETCH_TOPIC = 'SWR_USE_FETCH_TOPIC';
const SWR_USE_SEARCH_TOPIC = 'SWR_USE_SEARCH_TOPIC';

export interface ChatTopicAction {
  favoriteTopic: (id: string, favState: boolean) => Promise<void>;
  openNewTopicOrSaveTopic: () => Promise<void>;
  refreshTopic: () => Promise<void>;
  removeAllTopics: () => Promise<void>;
  removeSessionTopics: () => Promise<void>;
  removeGroupTopics: (groupId: string) => Promise<void>;
  removeTopic: (id: string) => Promise<void>;
  removeUnstarredTopic: () => Promise<void>;
  saveToTopic: (sessionId?: string, groupId?: string) => Promise<string | undefined>;
  createTopic: (sessionId?: string, groupId?: string) => Promise<string | undefined>;

  autoRenameTopicTitle: (id: string) => Promise<void>;
  duplicateTopic: (id: string) => Promise<void>;
  summaryTopicTitle: (topicId: string, messages: UIChatMessage[]) => Promise<void>;
  switchTopic: (id?: string, skipRefreshMessage?: boolean) => Promise<void>;
  updateTopicTitle: (id: string, title: string) => Promise<void>;
  useFetchTopics: (
    enable: boolean,
    sessionId?: string,
    groupId?: string,
  ) => SWRResponse<ChatTopic[]>;
  useSearchTopics: (
    keywords?: string,
    sessionId?: string,
    groupId?: string,
  ) => SWRResponse<ChatTopic[]>;

  internal_updateTopicTitleInSummary: (id: string, title: string) => void;
  internal_updateTopicLoading: (id: string, loading: boolean) => void;
  internal_createTopic: (params: CreateTopicParams) => Promise<string>;
  internal_updateTopic: (id: string, data: Partial<ChatTopic>) => Promise<void>;
  internal_dispatchTopic: (payload: ChatTopicDispatch, action?: any) => void;
}

export const chatTopic: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatTopicAction
> = (set, get) => ({
  // create
  openNewTopicOrSaveTopic: async () => {
    const { switchTopic, saveToTopic, refreshMessages, activeTopicId } = get();
    const hasTopic = !!activeTopicId;

    if (hasTopic) switchTopic();
    else {
      await saveToTopic();
      refreshMessages();
    }
  },

  createTopic: async (sessionId, groupId) => {
    const { activeId, activeSessionType, internal_createTopic } = get();

    const messages = chatSelectors.activeBaseChats(get());

    set({ creatingTopic: true }, false, n('creatingTopic/start'));
    const topicId = await internal_createTopic({
      title: t('defaultTitle', { ns: 'topic' }),
      messages: messages.map((m) => m.id),
      ...(activeSessionType === 'group'
        ? { groupId: groupId || activeId }
        : { sessionId: sessionId || activeId }),
    });
    set({ creatingTopic: false }, false, n('creatingTopic/end'));

    return topicId;
  },

  saveToTopic: async (sessionId, groupId) => {
    // if there is no message, stop
    const messages = chatSelectors.activeBaseChats(get());
    if (messages.length === 0) return;

    const { activeId, activeSessionType, summaryTopicTitle, internal_createTopic } = get();

    // 1. create topic and bind these messages
    const topicId = await internal_createTopic({
      title: t('defaultTitle', { ns: 'topic' }),
      messages: messages.map((m) => m.id),
      ...(activeSessionType === 'group'
        ? { groupId: groupId || activeId }
        : { sessionId: sessionId || activeId }),
    });

    get().internal_updateTopicLoading(topicId, true);
    // 2. auto summary topic Title
    // we don't need to wait for summary, just let it run async
    summaryTopicTitle(topicId, messages);

    // Clear supervisor todos for temporary topic in current container after saving
    try {
      const { activeId, activeSessionType } = get();
      let isGroupSession = activeSessionType === 'group';
      if (activeSessionType === undefined) {
        const sessionStore = useSessionStore.getState();
        isGroupSession = sessionSelectors.isCurrentSessionGroupSession(sessionStore);
      }

      if (isGroupSession) {
        set(
          produce((state: ChatStoreState) => {
            state.supervisorTodos[messageMapKey(groupId || activeId, null)] = [];
          }),
          false,
          n('resetSupervisorTodosOnSaveToTopic', { groupId: groupId || activeId }),
        );
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to reset supervisor todos on save to topic:', error);
      }
    }

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
    await get().internal_updateTopic(id, { favorite });
  },

  updateTopicTitle: async (id, title) => {
    await get().internal_updateTopic(id, { title });
  },

  autoRenameTopicTitle: async (id) => {
    const { activeId: sessionId, summaryTopicTitle, internal_updateTopicLoading } = get();

    internal_updateTopicLoading(id, true);
    const messages = await messageService.getMessages(sessionId, id);

    await summaryTopicTitle(id, messages);
    internal_updateTopicLoading(id, false);
  },

  // query
  useFetchTopics: (enable, containerId) =>
    useClientDataSWR<ChatTopic[]>(
      enable ? [SWR_USE_FETCH_TOPIC, containerId] : null,
      async ([, containerId]: [string, string | undefined]) =>
        topicService.getTopics({ containerId }),
      {
        onSuccess: (topics) => {
          if (!containerId) return;

          const nextMap = { ...get().topicMaps, [containerId]: topics };

          // no need to update map if the topics have been init and the map is the same
          if (get().topicsInit && isEqual(nextMap, get().topicMaps)) return;

          set(
            { topicMaps: nextMap, topicsInit: true },
            false,
            n('useFetchTopics(success)', { containerId }),
          );
        },
      },
    ),
  useSearchTopics: (keywords, sessionId, groupId) =>
    useSWR<ChatTopic[]>(
      [SWR_USE_SEARCH_TOPIC, keywords, sessionId, groupId],
      ([, keywords, sessionId, groupId]: [
        string,
        string,
        string | undefined,
        string | undefined,
      ]) => topicService.searchTopics(keywords, sessionId, groupId),
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

  switchTopic: async (id, skipRefreshMessage) => {
    set(
      { activeTopicId: !id ? (null as any) : id, activeThreadId: undefined },
      false,
      n('toggleTopic'),
    );

    // Reset supervisor todos when switching topics in group chats
    try {
      const { activeId, activeSessionType, internal_cancelSupervisorDecision } = get();
      // Determine group session robustly (cached flag or from session store)
      let isGroupSession = activeSessionType === 'group';
      if (activeSessionType === undefined) {
        const sessionStore = useSessionStore.getState();
        isGroupSession = sessionSelectors.isCurrentSessionGroupSession(sessionStore);
      }

      if (isGroupSession) {
        const newKey = messageMapKey(activeId, id ?? null);
        set(
          produce((state: ChatStoreState) => {
            state.supervisorTodos[newKey] = [];
          }),
          false,
          n('resetSupervisorTodosOnTopicSwitch', { groupId: activeId, topicId: id ?? null }),
        );

        // Also cancel any pending supervisor decisions tied to this group
        internal_cancelSupervisorDecision?.(activeId);
      }
    } catch {
      // no-op: resetting todos should not block topic switching
    }

    if (skipRefreshMessage) return;
    await get().refreshMessages();
  },
  // delete
  removeSessionTopics: async () => {
    const { switchTopic, activeId, refreshTopic } = get();

    await topicService.removeTopics(activeId);
    await refreshTopic();

    // switch to default topic
    switchTopic();
  },

  removeGroupTopics: async (groupId: string) => {
    const { switchTopic, refreshTopic } = get();

    // Get topics for this specific group from the topic map
    const groupTopics = get().topicMaps[groupId] || [];
    const topicIds = groupTopics.map((t) => t.id);

    if (topicIds.length > 0) {
      await topicService.batchRemoveTopics(topicIds);
    }

    await refreshTopic();

    // switch to default topic
    switchTopic();
  },
  removeAllTopics: async () => {
    const { refreshTopic } = get();

    await topicService.removeAllTopic();
    await refreshTopic();
  },
  removeTopic: async (id) => {
    const { activeId, activeTopicId, switchTopic, refreshTopic } = get();

    // remove messages in the topic
    // TODO: Need to remove because server service don't need to call it
    await messageService.removeMessagesByAssistant(activeId, id);

    // remove topic
    await topicService.removeTopic(id);
    await refreshTopic();

    // switch bach to default topic
    if (activeTopicId === id) switchTopic();
  },
  removeUnstarredTopic: async () => {
    const { refreshTopic, switchTopic } = get();
    const topics = topicSelectors.currentUnFavTopics(get());

    await topicService.batchRemoveTopics(topics.map((t) => t.id));
    await refreshTopic();

    // 切换到默认 topic
    switchTopic();
  },

  // Internal process method of the topics
  internal_updateTopicTitleInSummary: (id, title) => {
    get().internal_dispatchTopic(
      { type: 'updateTopic', id, value: { title } },
      'updateTopicTitleInSummary',
    );
  },
  refreshTopic: async () => {
    return mutate([SWR_USE_FETCH_TOPIC, get().activeId]);
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
    const nextTopics = topicReducer(topicSelectors.currentTopics(get()), payload);
    const nextMap = { ...get().topicMaps, [get().activeId]: nextTopics };

    // no need to update map if is the same
    if (isEqual(nextMap, get().topicMaps)) return;

    set({ topicMaps: nextMap }, false, action ?? n(`dispatchTopic/${payload.type}`));
  },
});
