import isEqual from 'fast-deep-equal';

import { defineLocalFirstPagedResource, defineLocalFirstResource } from '@/libs/localFirst';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import type { ChatTopic, TopicQuerySortBy } from '@/types/topic';

import type { TopicData } from './initialState';
import { type ChatTopicDispatch, topicReducer } from './reducer';

export interface TopicListParams {
  agentId?: string;
  excludeStatuses?: string[];
  excludeTriggers?: string[];
  groupId?: string;
  isInbox?: boolean;
  pageSize: number;
  sortBy?: TopicQuerySortBy;
  withDetails?: boolean;
}

export interface TopicAgentViewParams {
  agentId: string;
  pageSize: number;
  withDetails?: boolean;
}

const topicPaging = {
  direction: 'forward',
  getId: (topic: ChatTopic) => topic.id,
  mode: 'offset',
  // A reload repaints what the first network page would show, never a stale tail.
  persist: { pages: 1 },
} as const;

/**
 * Sidebar topic list, one entry per container (`agent_<id>` / `group_<id>` …).
 * The view is `topicDataMap[containerKey]`, so every existing selector keeps
 * reading the same place. Filters are the query identity: a projection taken
 * under other filters never paints (e.g. completed topics after hiding them).
 */
export const topicListResource = defineLocalFirstPagedResource<
  TopicListParams,
  ChatTopic,
  number,
  TopicData
>({
  key: ({ agentId, groupId }) => topicMapKey({ agentId, groupId }),
  name: 'topicList',
  paging: topicPaging,
  query: ({ excludeStatuses, excludeTriggers, isInbox, sortBy, withDetails }) => ({
    excludeStatuses,
    excludeTriggers,
    isInbox: Boolean(isInbox),
    sortBy,
    withDetails: Boolean(withDetails),
  }),
  storage: 'indexedDB',
  version: 2,
});

/**
 * Agent Topics management page (`/agent/:aid/topics`): a different shape of
 * the same entity — `withDetails` columns and a larger page — so it is its
 * own resource with its own view (`agentTopicsViewMap`) instead of a mirror.
 */
export const topicAgentViewResource = defineLocalFirstPagedResource<
  TopicAgentViewParams,
  ChatTopic,
  number,
  TopicData
>({
  key: ({ agentId }) => topicMapKey({ agentId }),
  name: 'topicAgentView',
  paging: topicPaging,
  query: ({ withDetails }) => ({ withDetails: Boolean(withDetails) }),
  storage: 'indexedDB',
  version: 1,
});

/** By-id topic detail cache (`topicDetailMap[topicId]`), for topics outside loaded lists. */
export const topicDetailResource = defineLocalFirstResource<string, ChatTopic, ChatTopic | null>({
  key: (topicId) => topicId,
  name: 'topicDetail',
  storage: 'indexedDB',
  version: 1,
});

/** Apply a topic dispatch to one container bucket (counts and `hasMore` included). */
export const applyTopicDispatchToBucket = (
  bucket: TopicData | undefined,
  payload: ChatTopicDispatch,
): TopicData | undefined => {
  // Nothing to patch: an update/delete for an unloaded container must not
  // create an empty bucket (it would read as "loaded, no topics" and block
  // the persisted projection from hydrating).
  if (!bucket && payload.type !== 'addTopic') return bucket;

  const items = topicReducer(bucket?.items, payload);
  if (bucket && isEqual(items, bucket.items)) return bucket;

  const currentTotal = bucket?.total ?? bucket?.items?.length ?? 0;
  const total =
    payload.type === 'addTopic'
      ? currentTotal + 1
      : payload.type === 'deleteTopic'
        ? Math.max(items.length, currentTotal - 1)
        : currentTotal;

  return {
    ...bucket,
    currentPage: bucket?.currentPage ?? 0,
    hasMore: total > items.length,
    isInbox: bucket?.isInbox,
    items,
    pageSize: bucket?.pageSize as number,
    total,
  };
};
