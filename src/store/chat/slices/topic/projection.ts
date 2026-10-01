import isEqual from 'fast-deep-equal';

import { defineLocalFirstResource } from '@/libs/localFirst';
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

export interface TopicListPage {
  items: ChatTopic[];
  total: number;
}

/**
 * Sidebar topic list, one entry per container (`agent_<id>` / `group_<id>` …).
 * The view is `topicDataMap[containerKey]`, so every existing selector keeps
 * reading the same place.
 */
export const topicListResource = defineLocalFirstResource<
  TopicListParams,
  TopicData,
  TopicListPage
>({
  key: ({ agentId, groupId }) => topicMapKey({ agentId, groupId }),
  name: 'topicList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * A container bucket is keyed by container only, not by filters, so a cached
 * page written under other filters must not paint (e.g. completed topics after
 * the user hid them).
 */
export const isTopicListHydratable = (cached: TopicData, params: TopicListParams) =>
  Boolean(cached.isInbox) === Boolean(params.isInbox) &&
  isEqual(cached.excludeStatuses, params.excludeStatuses) &&
  isEqual(cached.excludeTriggers, params.excludeTriggers) &&
  cached.sortBy === params.sortBy &&
  Boolean(cached.withDetails) === Boolean(params.withDetails);

/**
 * Persist only the first page, without transient paging flags or client-only
 * rows: a reload repaints what the first network page would show, never a
 * stale tail or a placeholder whose server row may not exist.
 */
export const toPersistedTopicList = (
  data: TopicData,
  clientOnlyIds: readonly string[],
): TopicData => {
  const items = (
    clientOnlyIds.length > 0
      ? data.items.filter((item) => !clientOnlyIds.includes(item.id))
      : data.items
  ).slice(0, data.pageSize || undefined);
  const {
    isExpandingPageSize: _expanding,
    isLoadingMore: _loadingMore,
    loadMoreError: _loadMoreError,
    ...rest
  } = data;
  return { ...rest, currentPage: 0, hasMore: data.total > items.length, items };
};

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
