import isEqual from 'fast-deep-equal';
import { current, produce } from 'immer';

import type { TopicMapScope } from '@/store/chat/utils/topicMapKey';
import type { ChatTopic, CreateTopicParams } from '@/types/topic';

export interface ChatTopicScope {
  agentId?: string;
  containerKey?: string;
  groupId?: string;
  scope?: TopicMapScope;
}

type AddChatTopicAction = ChatTopicScope & {
  optimistic?: boolean;
  type: 'addTopic';
  value: CreateTopicParams & { id?: string };
};

type UpdateChatTopicAction = ChatTopicScope & {
  id: string;
  type: 'updateTopic';
  value: Partial<ChatTopic>;
};

type DeleteChatTopicAction = ChatTopicScope & {
  id: string;
  type: 'deleteTopic';
};

type ReplaceChatTopicIdAction = ChatTopicScope & {
  id: string;
  nextId: string;
  type: 'replaceTopicId';
  value?: Partial<ChatTopic>;
};

export type ChatTopicDispatch =
  AddChatTopicAction | UpdateChatTopicAction | DeleteChatTopicAction | ReplaceChatTopicIdAction;

/** Pure collection mutation used by the canonical Projection action. */
export const reduceChatTopics = (
  state: ChatTopic[] = [],
  payload: ChatTopicDispatch,
): ChatTopic[] => {
  switch (payload.type) {
    case 'addTopic': {
      return produce(state, (draftState) => {
        draftState.unshift({
          ...payload.value,
          createdAt: Date.now(),
          favorite: false,
          id: payload.value.id ?? Date.now().toString(),
          sessionId: payload.value.sessionId || undefined,
          sortUpdatedAt: Date.now(),
          updatedAt: Date.now(),
        });

        return draftState.sort((a, b) => Number(b.favorite) - Number(a.favorite));
      });
    }

    case 'updateTopic': {
      return produce(state, (draftState) => {
        const topicIndex = draftState.findIndex((topic) => topic.id === payload.id);
        if (topicIndex === -1) return;

        const currentTopic = draftState[topicIndex];
        const mergedTopic = { ...currentTopic, ...payload.value };
        if (isEqual(current(currentTopic), mergedTopic)) return;

        // `updatedAt` is display/edit time. Ordering changes only when callers
        // explicitly update `sortUpdatedAt`.
        draftState[topicIndex] = { ...mergedTopic, updatedAt: Date.now() };
      });
    }

    case 'replaceTopicId': {
      return produce(state, (draftState) => {
        const topicIndex = draftState.findIndex((topic) => topic.id === payload.id);
        const existingNextIndex = draftState.findIndex((topic) => topic.id === payload.nextId);
        if (topicIndex === -1) return;

        draftState[topicIndex] = {
          ...draftState[topicIndex],
          ...(existingNextIndex === -1 ? undefined : draftState[existingNextIndex]),
          ...payload.value,
          id: payload.nextId,
          sortUpdatedAt: Date.now(),
          updatedAt: Date.now(),
        };

        if (existingNextIndex !== -1 && existingNextIndex !== topicIndex) {
          draftState.splice(existingNextIndex, 1);
        }
      });
    }

    case 'deleteTopic': {
      return state.filter((topic) => topic.id !== payload.id);
    }
  }
};
