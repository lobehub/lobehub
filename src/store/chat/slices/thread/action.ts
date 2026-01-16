/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import { LOADING_FLAT } from '@lobechat/const';
import { chainSummaryTitle } from '@lobechat/prompts';
import {
  type CreateMessageParams,
  type IThreadType,
  type ThreadItem,
  type UIChatMessage,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { threadService } from '@/services/thread';
import { threadSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { displayMessageSelectors } from '../message/selectors';
import { PortalViewType } from '../portal/initialState';
import { type ThreadDispatch, threadReducer } from './reducer';
import { genParentMessages } from './selectors';

const n = setNamespace('thd');
const SWR_USE_FETCH_THREADS = 'SWR_USE_FETCH_THREADS';

export interface ChatThreadAction {
  // update
  updateThreadInputMessage: (message: string) => void;
  refreshThreads: () => Promise<void>;
  createThread: (params: {
    message: CreateMessageParams;
    sourceMessageId: string;
    topicId: string;
    type: IThreadType;
  }) => Promise<{ threadId: string; messageId: string }>;
  openThreadCreator: (messageId: string) => void;
  openThreadInPortal: (threadId: string, sourceMessageId?: string | null) => void;
  closeThreadPortal: () => void;
  useFetchThreads: (enable: boolean, topicId?: string) => SWRResponse<ThreadItem[]>;
  summaryThreadTitle: (threadId: string, messages: UIChatMessage[]) => Promise<void>;
  updateThreadTitle: (id: string, title: string) => Promise<void>;
  removeThread: (id: string) => Promise<void>;
  switchThread: (id: string) => void;

  internal_updateThreadTitleInSummary: (id: string, title: string) => void;
  internal_updateThreadLoading: (id: string, loading: boolean) => void;
  internal_updateThread: (id: string, data: Partial<ThreadItem>) => Promise<void>;
  internal_dispatchThread: (payload: ThreadDispatch, action?: any) => void;
}

export const chatThreadMessage: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatThreadAction
> = (set, get) => ({
  updateThreadInputMessage: (message) => {
    if (isEqual(message, get().threadInputMessage)) return;

    set({ threadInputMessage: message }, false, n(`updateThreadInputMessage`, message));
  },

  openThreadCreator: (messageId) => {
    const { activeAgentId, activeTopicId, newThreadMode, replaceMessages } = get();

    // Get parent messages up to and including the source message
    const displayMessages = displayMessageSelectors.activeDisplayMessages(get());
    // Filter out messages that have threadId (they belong to other threads)
    const mainMessages = displayMessages.filter((m) => !m.threadId);
    const parentMessages = genParentMessages(mainMessages, messageId, newThreadMode);

    // Initialize messages in thread scope for optimistic update
    // This ensures the UI can display messages immediately
    if (parentMessages.length > 0) {
      const context = {
        agentId: activeAgentId,
        isNew: true,
        scope: 'thread' as const,
        topicId: activeTopicId,
      };
      replaceMessages(parentMessages, { action: 'initThreadMessages', context });
    }

    set(
      { threadStartMessageId: messageId, portalThreadId: undefined, startToForkThread: true },
      false,
      'openThreadCreator',
    );
    // Push Thread view to portal stack instead of togglePortal
    get().pushPortalView({ type: PortalViewType.Thread, startMessageId: messageId });
  },
  openThreadInPortal: (threadId, sourceMessageId) => {
    set(
      { portalThreadId: threadId, threadStartMessageId: sourceMessageId, startToForkThread: false },
      false,
      'openThreadInPortal',
    );
    // Push Thread view to portal stack with threadId
    get().pushPortalView({
      type: PortalViewType.Thread,
      threadId,
      startMessageId: sourceMessageId ?? undefined,
    });
  },

  closeThreadPortal: () => {
    set(
      { threadStartMessageId: undefined, portalThreadId: undefined, startToForkThread: undefined },
      false,
      'closeThreadPortal',
    );
    get().clearPortalStack();
  },
  createThread: async ({ message, sourceMessageId, topicId, type }) => {
    set({ isCreatingThread: true }, false, n('creatingThread/start'));

    const data = await threadService.createThreadWithMessage({
      topicId,
      sourceMessageId,
      type,
      message,
    });
    set({ isCreatingThread: false }, false, n('creatingThread/end'));

    return data;
  },

  useFetchThreads: (enable, topicId) =>
    useClientDataSWR<ThreadItem[]>(
      enable && !!topicId ? [SWR_USE_FETCH_THREADS, topicId] : null,
      async ([, topicId]: [string, string]) => threadService.getThreads(topicId),
      {
        onSuccess: (threads) => {
          const nextMap = { ...get().threadMaps, [topicId!]: threads };

          // no need to update map if the threads have been init and the map is the same
          if (get().threadsInit && isEqual(nextMap, get().threadMaps)) return;

          set(
            { threadMaps: nextMap, threadsInit: true },
            false,
            n('useFetchThreads(success)', { topicId }),
          );
        },
      },
    ),

  refreshThreads: async () => {
    const topicId = get().activeTopicId;
    if (!topicId) return;

    return mutate([SWR_USE_FETCH_THREADS, topicId]);
  },
  removeThread: async (id) => {
    await threadService.removeThread(id);
    await get().refreshThreads();

    if (get().activeThreadId === id) {
      set({ activeThreadId: undefined });
    }
  },
  switchThread: async (id) => {
    set({ activeThreadId: id }, false, n('toggleTopic'));
  },
  updateThreadTitle: async (id, title) => {
    await get().internal_updateThread(id, { title });
  },

  summaryThreadTitle: async (threadId, messages) => {
    const { internal_updateThreadTitleInSummary, internal_updateThreadLoading } = get();
    const portalThread = threadSelectors.currentPortalThread(get());
    if (!portalThread) return;

    internal_updateThreadTitleInSummary(threadId, LOADING_FLAT);

    let output = '';
    const threadConfig = systemAgentSelectors.thread(useUserStore.getState());

    await chatService.fetchPresetTaskResult({
      onError: () => {
        internal_updateThreadTitleInSummary(threadId, portalThread.title);
      },
      onFinish: async (text) => {
        await get().internal_updateThread(threadId, { title: text });
      },
      onLoadingChange: (loading) => {
        internal_updateThreadLoading(threadId, loading);
      },
      onMessageHandle: (chunk) => {
        switch (chunk.type) {
          case 'text': {
            output += chunk.text;
          }
        }

        internal_updateThreadTitleInSummary(threadId, output);
      },
      params: merge(threadConfig, chainSummaryTitle(messages, globalHelpers.getCurrentLanguage())),
    });
  },

  // Internal process method of the topics
  internal_updateThreadTitleInSummary: (id, title) => {
    get().internal_dispatchThread(
      { type: 'updateThread', id, value: { title } },
      'updateThreadTitleInSummary',
    );
  },

  internal_updateThreadLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) return { threadLoadingIds: [...state.threadLoadingIds, id] };

        return { threadLoadingIds: state.threadLoadingIds.filter((i) => i !== id) };
      },
      false,
      n('updateThreadLoading'),
    );
  },

  internal_updateThread: async (id, data) => {
    get().internal_dispatchThread({ type: 'updateThread', id, value: data });

    get().internal_updateThreadLoading(id, true);
    await threadService.updateThread(id, data);
    await get().refreshThreads();
    get().internal_updateThreadLoading(id, false);
  },

  internal_dispatchThread: (payload, action) => {
    const nextThreads = threadReducer(threadSelectors.currentTopicThreads(get()), payload);
    const nextMap = { ...get().threadMaps, [get().activeTopicId!]: nextThreads };

    // no need to update map if is the same
    if (isEqual(nextMap, get().threadMaps)) return;

    set({ threadMaps: nextMap }, false, action ?? n(`dispatchThread/${payload.type}`));
  },
});
