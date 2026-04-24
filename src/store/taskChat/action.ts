import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { type StoreSetter } from '@/store/types';
import { type ChatTopic } from '@/types/topic';
import { setNamespace } from '@/utils/storeDebug';

import { type TaskChatStore } from './store';

const n = setNamespace('taskChat');

const SWR_USE_FETCH_TASK_TOPICS = 'SWR_USE_FETCH_TASK_TOPICS';

type Setter = StoreSetter<TaskChatStore>;

export const createTaskChatSlice = (set: Setter, get: () => TaskChatStore, _api?: unknown) =>
  new TaskChatActionImpl(set, get, _api);

export class TaskChatActionImpl {
  readonly #get: () => TaskChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => TaskChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  switchTopic = (id: string | null): void => {
    if (this.#get().activeTopicId === id) return;
    this.#set({ activeTopicId: id }, false, n('switchTopic'));
  };

  /**
   * Called by `ConversationHooks.onTopicCreated` after the backend creates
   * a new topic from this panel's sendMessage. Writes the new id into the
   * isolated store and refreshes the local topic list.
   */
  onTopicCreated = async (topicId: string): Promise<void> => {
    this.#set({ activeTopicId: topicId }, false, n('onTopicCreated'));
    await this.refreshTopics();
  };

  refreshTopics = async (): Promise<void> => {
    const { activeAgentId } = useChatStore.getState();
    if (!activeAgentId) return;
    await mutate(
      (key) =>
        Array.isArray(key) && key[0] === SWR_USE_FETCH_TASK_TOPICS && key[1] === activeAgentId,
    );
  };

  useFetchTopics = (
    agentId: string | undefined,
    includeTriggers: string[],
  ): SWRResponse<ChatTopic[]> => {
    return useClientDataSWRWithSync<ChatTopic[]>(
      agentId ? [SWR_USE_FETCH_TASK_TOPICS, agentId, includeTriggers.join(',')] : null,
      async () => {
        if (!agentId) return [];
        const result = await topicService.getTopics({
          agentId,
          current: 0,
          includeTriggers,
          pageSize: 100,
        });
        return result.items;
      },
      {
        onData: (topics) => {
          if (!topics) return;
          if (isEqual(topics, this.#get().topics)) return;
          this.#set({ topics }, false, n('useFetchTopics(onData)'));
        },
      },
    );
  };
}

export type TaskChatAction = Pick<TaskChatActionImpl, keyof TaskChatActionImpl>;
