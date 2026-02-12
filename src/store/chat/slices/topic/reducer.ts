import isEqual from 'fast-deep-equal';
import { produce } from 'immer';

import { type ChatTopic, type CreateTopicParams } from '@/types/topic';

type AddChatTopicAction = {
  type: 'addTopic';
  value: CreateTopicParams & { id?: string };
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
          createdAt: Date.now(),
          favorite: false,
          id: payload.value.id ?? Date.now().toString(),
          sessionId: payload.value.sessionId ? payload.value.sessionId : undefined,
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

          // Only update if the merged value is different from current (excluding updatedAt)

          if (!isEqual(currentTopic, mergedTopic)) {
            // TODO: updatedAt 类型后续需要修改为 Date
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
