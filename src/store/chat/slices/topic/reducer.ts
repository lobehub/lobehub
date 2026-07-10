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
          // A brand-new topic is fresh activity: seed the sidebar sort key so it
          // lands at the top immediately, matching the server's `topicActivityAt`
          // once the real row is fetched. (LOBE-11543)
          sortUpdatedAt: Date.now(),
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
            // Bump `updatedAt` (display/edit time) on every real write. The sidebar
            // no longer sorts by `updatedAt` — it sorts by `sortUpdatedAt` (activity
            // time) — so a status flip bumping `updatedAt` here can't reorder the
            // list; only an explicit `sortUpdatedAt` in `value` moves a row. (LOBE-11543)
            // TODO: updatedAt type needs to be changed to Date later
            // @ts-ignore
            draftState[topicIndex] = { ...mergedTopic, updatedAt: new Date() };
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
          // Resolving a first-send optimistic topic to its real id is fresh activity:
          // keep it pinned to the top via the sidebar sort key (`sortUpdatedAt`), not
          // just `updatedAt` which the sidebar no longer sorts by. (LOBE-11543)
          sortUpdatedAt: Date.now(),
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
