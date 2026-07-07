import isEqual from 'fast-deep-equal';
import { current, produce } from 'immer';

import { type TopicMapScope } from '@/store/chat/utils/topicMapKey';
import { type ChatTopic, type CreateTopicParams } from '@/types/topic';

/**
 * Optional scope on every topic dispatch. When set, `internal_dispatchTopic`
 * routes the write to the matching bucket in `topicDataMap` regardless of
 * `activeAgentId` — used when an agent run completes after the user has
 * switched agents and the write must land in the run's *owning* bucket, not
 * whichever bucket happens to be active.
 */
interface ChatTopicScope {
  agentId?: string;
  groupId?: string;
  scope?: TopicMapScope;
}

type AddChatTopicAction = ChatTopicScope & {
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

export const topicReducer = (state: ChatTopic[] = [], payload: ChatTopicDispatch): ChatTopic[] => {
  switch (payload.type) {
    case 'addTopic': {
      return produce(state, (draftState) => {
        draftState.unshift({
          ...payload.value,
          createdAt: Date.now(),
          favorite: false,
          id: payload.value.id ?? Date.now().toString(),
          sessionId: payload.value.sessionId || undefined,
          updatedAt: Date.now(),
        });

        return draftState.sort((a, b) => Number(b.favorite) - Number(a.favorite));
      });
    }

    case 'updateTopic': {
      return produce(state, (draftState) => {
        const { value, id } = payload;
        const topicIndex = draftState.findIndex((topic) => topic.id === id);

        if (topicIndex !== -1) {
          const currentTopic = draftState[topicIndex];
          const mergedTopic = { ...currentTopic, ...value };

          // Only update if the merged value is different from current (excluding updatedAt).
          // Compare against a plain snapshot, not the raw draft proxy — see message/reducer.ts.
          if (!isEqual(current(currentTopic), mergedTopic)) {
            // Status flips (running/unread/read bookkeeping) are not user activity —
            // bumping updatedAt here reorders the updatedAt-sorted sidebar on every
            // run end / topic read, and the bump reverts on the next refetch (the
            // server orders by latest-message time), so rows visibly jump around.
            const isStatusOnlyWrite = Object.keys(value).every((key) => key === 'status');

            if (isStatusOnlyWrite) {
              draftState[topicIndex] = mergedTopic;
            } else {
              // TODO: updatedAt type needs to be changed to Date later
              // @ts-ignore
              draftState[topicIndex] = { ...mergedTopic, updatedAt: new Date() };
            }
          }
        }
      });
    }

    case 'replaceTopicId': {
      return produce(state, (draftState) => {
        const { value, id, nextId } = payload;
        const topicIndex = draftState.findIndex((topic) => topic.id === id);
        const existingNextIndex = draftState.findIndex((topic) => topic.id === nextId);

        if (topicIndex === -1) return;

        const currentTopic = draftState[topicIndex];
        const nextTopic = existingNextIndex === -1 ? undefined : draftState[existingNextIndex];
        draftState[topicIndex] = {
          ...currentTopic,
          ...nextTopic,
          ...value,
          id: nextId,
          updatedAt: Date.now(),
        };

        if (existingNextIndex !== -1 && existingNextIndex !== topicIndex) {
          draftState.splice(existingNextIndex, 1);
        }
      });
    }

    case 'deleteTopic': {
      return produce(state, (draftState) => {
        const topicIndex = draftState.findIndex((topic) => topic.id === payload.id);
        if (topicIndex !== -1) {
          draftState.splice(topicIndex, 1);
        }
      });
    }

    default: {
      return state;
    }
  }
};
