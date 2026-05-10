import isEqual from 'fast-deep-equal';
import { produce } from 'immer';

import { type ChatTopic, type CreateTopicParams } from '@/types/topic';

type AddChatTopicAction = {
  type: 'addTopic';
  /**
   * Accepts `CreateTopicParams` plus optional fields the caller may already
   * know (id, createdAt, updatedAt, etc.). When the reducer is fed a fully-
   * formed topic from the server, those values win over local defaults.
   */
  value: CreateTopicParams & Partial<Omit<ChatTopic, 'sessionId'>> & { id?: string };
};

type UpdateChatTopicAction = {
  id: string;
  type: 'updateTopic';
  value: Partial<ChatTopic>;
};

type DeleteChatTopicAction = {
  id: string;
  type: 'deleteTopic';
};

export type ChatTopicDispatch = AddChatTopicAction | UpdateChatTopicAction | DeleteChatTopicAction;

export const topicReducer = (state: ChatTopic[] = [], payload: ChatTopicDispatch): ChatTopic[] => {
  switch (payload.type) {
    case 'addTopic': {
      return produce(state, (draftState) => {
        draftState.unshift({
          ...payload.value,
          // Prefer caller-supplied values; fall back to local defaults so the
          // existing optimistic `internal_createTopic` path keeps working.
          createdAt: payload.value.createdAt ?? Date.now(),
          favorite: payload.value.favorite ?? false,
          id: payload.value.id ?? Date.now().toString(),
          sessionId: payload.value.sessionId || undefined,
          updatedAt: payload.value.updatedAt ?? Date.now(),
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

          // Only update if the merged value is different from current (excluding updatedAt)

          if (!isEqual(currentTopic, mergedTopic)) {
            // TODO: updatedAt type needs to be changed to Date later
            // @ts-ignore
            draftState[topicIndex] = { ...mergedTopic, updatedAt: new Date() };
          }
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
