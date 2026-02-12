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
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { threadService } from '@/services/thread';
import { threadSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { displayMessageSelectors } from '../message/selectors';
import { PortalViewType } from '../portal/initialState';
import { type ThreadDispatch } from './reducer';
import { threadReducer } from './reducer';
import { genParentMessages } from './selectors';

const n = setNamespace('thd');
const SWR_USE_FETCH_THREADS = 'SWR_USE_FETCH_THREADS';

type Setter = StoreSetter<ChatStore>;
export const chatThreadMessage = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ChatThreadActionImpl(set, get, _api);

export class ChatThreadActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  updateThreadInputMessage = (message: string): void => {
    if (isEqual(message, this.#get().threadInputMessage)) return;

    this.#set({ threadInputMessage: message }, false, n(`updateThreadInputMessage`, message));
  };

  openThreadCreator = (messageId: string): void => {
    const { activeAgentId, activeTopicId, newThreadMode, replaceMessages } = this.#get();

    // Get parent messages up to and including the source message
    const displayMessages = displayMessageSelectors.activeDisplayMessages(this.#get());
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

    this.#set(
      { threadStartMessageId: messageId, portalThreadId: undefined, startToForkThread: true },
      false,
      'openThreadCreator',
    );
    // Push Thread view to portal stack instead of togglePortal
    this.#get().pushPortalView({ type: PortalViewType.Thread, startMessageId: messageId });
  };

  openThreadInPortal = (threadId: string, sourceMessageId?: string | null): void => {
    this.#set(
      { portalThreadId: threadId, threadStartMessageId: sourceMessageId, startToForkThread: false },
      false,
      'openThreadInPortal',
    );
    // Push Thread view to portal stack with threadId
    this.#get().pushPortalView({
      type: PortalViewType.Thread,
      threadId,
      startMessageId: sourceMessageId ?? undefined,
    });
  };

  closeThreadPortal = (): void => {
    this.#set(
      { threadStartMessageId: undefined, portalThreadId: undefined, startToForkThread: undefined },
      false,
      'closeThreadPortal',
    );
    this.#get().clearPortalStack();
  };

  createThread = async ({
    message,
    sourceMessageId,
    topicId,
    type,
  }: {
    message: CreateMessageParams;
    sourceMessageId: string;
    topicId: string;
    type: IThreadType;
  }): Promise<{ threadId: string; messageId: string }> => {
    this.#set({ isCreatingThread: true }, false, n('creatingThread/start'));

    const data = await threadService.createThreadWithMessage({
      topicId,
      sourceMessageId,
      type,
      message,
    });
    this.#set({ isCreatingThread: false }, false, n('creatingThread/end'));

    return data;
  };

  useFetchThreads = (enable: boolean, topicId?: string): SWRResponse<ThreadItem[]> => {
    return useClientDataSWR<ThreadItem[]>(
      enable && !!topicId ? [SWR_USE_FETCH_THREADS, topicId] : null,
      async ([, topicId]: [string, string]) => threadService.getThreads(topicId),
      {
        onSuccess: (threads) => {
          const nextMap = { ...this.#get().threadMaps, [topicId!]: threads };

          // no need to update map if the threads have been init and the map is the same
          if (this.#get().threadsInit && isEqual(nextMap, this.#get().threadMaps)) return;

          this.#set(
            { threadMaps: nextMap, threadsInit: true },
            false,
            n('useFetchThreads(success)', { topicId }),
          );
        },
      },
    );
  };

  refreshThreads = async (): Promise<void> => {
    const topicId = this.#get().activeTopicId;
    if (!topicId) return;

    return mutate([SWR_USE_FETCH_THREADS, topicId]);
  };

  removeThread = async (id: string): Promise<void> => {
    await threadService.removeThread(id);
    await this.#get().refreshThreads();

    if (this.#get().activeThreadId === id) {
      this.#set({ activeThreadId: undefined });
    }
  };

  switchThread = async (id: string): Promise<void> => {
    this.#set({ activeThreadId: id }, false, n('toggleTopic'));
  };

  updateThreadTitle = async (id: string, title: string): Promise<void> => {
    await this.#get().internal_updateThread(id, { title });
  };

  summaryThreadTitle = async (threadId: string, messages: UIChatMessage[]): Promise<void> => {
    const { internal_updateThreadTitleInSummary, internal_updateThreadLoading } = this.#get();
    const portalThread = threadSelectors.currentPortalThread(this.#get());
    if (!portalThread) return;

    internal_updateThreadTitleInSummary(threadId, LOADING_FLAT);

    let output = '';
    const threadConfig = systemAgentSelectors.thread(useUserStore.getState());

    await chatService.fetchPresetTaskResult({
      onError: () => {
        internal_updateThreadTitleInSummary(threadId, portalThread.title);
      },
      onFinish: async (text) => {
        await this.#get().internal_updateThread(threadId, { title: text });
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
  };

  internal_updateThreadTitleInSummary = (id: string, title: string): void => {
    this.#get().internal_dispatchThread(
      { type: 'updateThread', id, value: { title } },
      'updateThreadTitleInSummary',
    );
  };

  internal_updateThreadLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) return { threadLoadingIds: [...state.threadLoadingIds, id] };

        return { threadLoadingIds: state.threadLoadingIds.filter((i) => i !== id) };
      },
      false,
      n('updateThreadLoading'),
    );
  };

  internal_updateThread = async (id: string, data: Partial<ThreadItem>): Promise<void> => {
    this.#get().internal_dispatchThread({ type: 'updateThread', id, value: data });

    this.#get().internal_updateThreadLoading(id, true);
    await threadService.updateThread(id, data);
    await this.#get().refreshThreads();
    this.#get().internal_updateThreadLoading(id, false);
  };

  internal_dispatchThread = (payload: ThreadDispatch, action?: any): void => {
    const nextThreads = threadReducer(threadSelectors.currentTopicThreads(this.#get()), payload);
    const nextMap = { ...this.#get().threadMaps, [this.#get().activeTopicId!]: nextThreads };

    // no need to update map if is the same
    if (isEqual(nextMap, this.#get().threadMaps)) return;

    this.#set({ threadMaps: nextMap }, false, action ?? n(`dispatchThread/${payload.type}`));
  };
}

export type ChatThreadAction = Pick<ChatThreadActionImpl, keyof ChatThreadActionImpl>;
