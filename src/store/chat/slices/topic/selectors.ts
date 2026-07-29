import { isDesktop } from '@lobechat/const';
import { getWorkingDirEffectivePath } from '@lobechat/types';
import { t } from 'i18next';

import {
  type ChatTopic,
  type ChatTopicSummary,
  type GroupedTopic,
  type TopicGroupMode,
  type TopicSortBy,
} from '@/types/topic';
import {
  getTopicSortTime,
  groupTopicsByProject,
  groupTopicsByStatus,
  groupTopicsByTime,
  groupTopicsByUpdatedTime,
} from '@/utils/client/topic';

import { type ChatStoreState } from '../../initialState';
import { topicMapKey } from '../../utils/topicMapKey';
import { operationSelectors } from '../operation/selectors';
import { type TopicData } from './initialState';

// Helper selector: get current topic data based on session context
const currentTopicData = (s: ChatStoreState): TopicData | undefined => {
  const key = topicMapKey({
    agentId: s.activeAgentId,
    groupId: s.activeGroupId,
  });
  return s.topicDataMap[key];
};

const currentTopics = (s: ChatStoreState): ChatTopic[] | undefined => currentTopicData(s)?.items;

// Get topics without cron-triggered ones
const currentTopicsWithoutCron = (s: ChatStoreState): ChatTopic[] | undefined => {
  const topics = currentTopics(s);
  if (!topics) return undefined;
  return topics.filter((topic) => topic.trigger !== 'cron');
};

const currentActiveTopic = (s: ChatStoreState): ChatTopic | undefined => {
  return currentTopics(s)?.find((topic) => topic.id === s.activeTopicId);
};
const searchTopics = (s: ChatStoreState): ChatTopic[] => s.searchTopics;

const displayTopics = (s: ChatStoreState): ChatTopic[] | undefined => currentTopicsWithoutCron(s);

const currentUnFavTopics = (s: ChatStoreState): ChatTopic[] =>
  currentTopicsWithoutCron(s)?.filter((s) => !s.favorite) || [];

const currentTopicLength = (s: ChatStoreState): number => currentTopicsWithoutCron(s)?.length || 0;

const currentTopicCount = (s: ChatStoreState): number => currentTopicData(s)?.total || 0;

const getTopicById =
  (id: string) =>
  (s: ChatStoreState): ChatTopic | undefined =>
    currentTopics(s)?.find((topic) => topic.id === id); // Don't filter here, need to access all topics by ID

/**
 * Get topics by specific agentId (for AgentBuilder scenarios where agentId differs from activeAgentId)
 */
const getTopicsByAgentId =
  (agentId: string) =>
  (s: ChatStoreState): ChatTopic[] | undefined => {
    const key = topicMapKey({ agentId });
    return s.topicDataMap[key]?.items;
  };

const currentActiveTopicSummary = (s: ChatStoreState): ChatTopicSummary | undefined => {
  const activeTopic = currentActiveTopic(s);
  if (!activeTopic) return undefined;

  return {
    content: activeTopic.historySummary || '',
    model: activeTopic.metadata?.model || '',
    provider: activeTopic.metadata?.provider || '',
  };
};

const currentTopicMetadata = (s: ChatStoreState) => currentActiveTopic(s)?.metadata;

/**
 * Get the model/provider pinned to a specific topic (snapshotted on creation,
 * updated when the user switches model while the topic is active).
 * Returns undefined when the topic has no model recorded (e.g. legacy topics),
 * in which case callers should fall back to the agent default.
 */
const getTopicModelById =
  (id: string) =>
  (s: ChatStoreState): { model: string; provider: string } | undefined => {
    const topic = getTopicById(id)(s);
    if (!topic?.model) return undefined;

    return { model: topic.model, provider: topic.provider || '' };
  };

/**
 * The model/provider pinned to the active topic, or undefined when there is no
 * active topic or it has no model recorded.
 */
const activeTopicModel = (s: ChatStoreState): { model: string; provider: string } | undefined => {
  if (!s.activeTopicId) return undefined;
  return getTopicModelById(s.activeTopicId)(s);
};

/**
 * Extract a topic's working directory from its metadata.
 * On desktop: local filesystem path.
 * On web (cloud): primary GitHub repo URL (repos[0]), or workingDirectory if set directly.
 */
const extractTopicWorkingDirectory = (topic: ChatTopic | undefined): string | undefined => {
  if (!topic) return;

  // Route the raw `workingDirectory` through the extractor too: it is typed as a
  // string, but a malformed legacy topic may have persisted a `WorkingDirConfig`
  // object into it (see #17050 and `getTopicMetadataWorkingDirectorySourcePath`),
  // and this selector's declared `string | undefined` must hold at runtime.
  if (isDesktop) {
    return getWorkingDirEffectivePath(
      topic.metadata?.workingDirectoryConfig ?? topic.metadata?.workingDirectory,
    );
  }

  // Web: return primary repo from repos list, or workingDirectory if set directly
  const meta = topic.metadata;
  return (
    meta?.repos?.[0] ??
    getWorkingDirEffectivePath(meta?.workingDirectoryConfig ?? meta?.workingDirectory)
  );
};

/**
 * Get a topic's working directory by id, falling back to the active topic when
 * no id is given. Prefer the explicit-id form for async work (e.g. a streaming
 * tool call): the executing topic is captured at request time, so reading the
 * *active* topic here would return the wrong project if the user switched topics
 * mid-stream.
 */
const getTopicWorkingDirectory =
  (id?: string | null) =>
  (s: ChatStoreState): string | undefined =>
    extractTopicWorkingDirectory(id ? getTopicById(id)(s) : currentActiveTopic(s));

/**
 * Get current active topic's working directory.
 */
const currentTopicWorkingDirectory = (s: ChatStoreState): string | undefined =>
  extractTopicWorkingDirectory(currentActiveTopic(s));

const isCreatingTopic = (s: ChatStoreState) => s.creatingTopic;

/**
 * Whether a send from the new-topic view is still in flight — no active topic
 * yet, while the running send owns creation of the real topic (the `_new`
 * context only holds optimistic tmp_* messages until then). While true,
 * `openNewTopicOrSaveTopic` is a no-op, so its entry buttons should be
 * disabled to make the blocked window visible instead of silently ignoring
 * the click.
 */
const isNewTopicSendInFlight = (s: ChatStoreState): boolean =>
  !s.activeTopicId &&
  operationSelectors.isInputLoadingByContext({
    agentId: s.activeAgentId,
    groupId: s.activeGroupId,
    threadId: s.activeThreadId,
    topicId: s.activeTopicId,
  })(s);
const isUndefinedTopics = (s: ChatStoreState) => !currentTopics(s);
const isInSearchMode = (s: ChatStoreState) => s.inSearchingMode;
const isSearchingTopic = (s: ChatStoreState) => s.isSearchingTopic;

const sortTopics = (topics: ChatTopic[], sortBy: TopicSortBy): ChatTopic[] => {
  const field = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
  return [...topics].sort((a, b) => getTopicSortTime(b, field) - getTopicSortTime(a, field));
};

// Limit topics for sidebar display based on user's page size preference
const displayTopicsForSidebar =
  (pageSize: number, sortBy: TopicSortBy = 'updatedAt', includeCompleted = true) =>
  (s: ChatStoreState): ChatTopic[] | undefined => {
    const topics = currentTopicsWithoutCron(s);
    if (!topics) return undefined;

    const visibleTopics = includeCompleted
      ? topics
      : topics.filter((topic) => topic.status !== 'completed');

    // Favorites first, then sorted by the chosen timestamp, then page-sliced
    const favTopics = visibleTopics.filter((t) => t.favorite);
    const rest = visibleTopics.filter((t) => !t.favorite);
    return [...sortTopics(favTopics, sortBy), ...sortTopics(rest, sortBy)].slice(0, pageSize);
  };

const getGroupFn = (
  groupMode: TopicGroupMode,
  sortBy: TopicSortBy,
  loadingTopicIds?: ReadonlySet<string>,
) => {
  const field: 'createdAt' | 'updatedAt' = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
  if (groupMode === 'byProject') {
    return (topics: ChatTopic[]) =>
      groupTopicsByProject(topics, field).map((group) =>
        group.id === 'no-project'
          ? { ...group, title: t('groupTitle.byProject.noProject', { ns: 'topic' }) }
          : group,
      );
  }
  if (groupMode === 'byStatus') {
    return (topics: ChatTopic[]) =>
      groupTopicsByStatus(topics, field, loadingTopicIds).map((group) => ({
        ...group,
        title: t(`groupTitle.byStatus.${group.id}` as any, { ns: 'topic' }),
      }));
  }
  return sortBy === 'updatedAt' ? groupTopicsByUpdatedTime : groupTopicsByTime;
};

/**
 * Build grouped topics from a topic list, splitting favorites into a separate group
 */
const buildGroupedTopics = (
  topics: ChatTopic[],
  groupFn: (topics: ChatTopic[]) => GroupedTopic[],
): GroupedTopic[] => {
  const favTopics = topics.filter((topic) => topic.favorite);
  const unfavTopics = topics.filter((topic) => !topic.favorite);

  // Favorites stay pinned at the very top. The "needs attention" bucket
  // (byStatus mode only) follows right below, ahead of the remaining status
  // groups, since groupTopicsByStatus emits `pending` first (STATUS_GROUP_ORDER).
  return favTopics.length > 0
    ? [
        {
          children: favTopics,
          id: 'favorite',
          title: t('favorite', { ns: 'topic' }),
        },
        ...groupFn(unfavTopics),
      ]
    : groupFn(topics);
};

const groupedTopicsSelector =
  (groupFn: typeof groupTopicsByTime = groupTopicsByTime) =>
  (s: ChatStoreState): GroupedTopic[] => {
    const topics = displayTopics(s);
    if (!topics) return [];
    return buildGroupedTopics(topics, groupFn);
  };

const groupedTopicsForSidebar =
  (
    pageSize: number,
    sortBy: TopicSortBy = 'updatedAt',
    groupMode: TopicGroupMode = 'byTime',
    includeCompleted = true,
  ) =>
  (s: ChatStoreState): GroupedTopic[] => {
    const limitedTopics = displayTopicsForSidebar(pageSize, sortBy, includeCompleted)(s);
    if (!limitedTopics) return [];
    // Topics actively streaming on this client surface under "running" even
    // though their persisted status says otherwise — that's the one client-only
    // overlay (see resolveStatusBucket). Unread is now a persisted status, so it
    // buckets straight from `topic.status`.
    const loadingTopicIds = groupMode === 'byStatus' ? new Set(s.topicLoadingIds) : undefined;
    return buildGroupedTopics(limitedTopics, getGroupFn(groupMode, sortBy, loadingTopicIds));
  };

const hasMoreTopics = (s: ChatStoreState): boolean => {
  const topicData = currentTopicData(s);
  if (!topicData) return false;

  return topicData.hasMore;
};

const hasMoreTopicsForSidebar = (s: ChatStoreState): boolean => {
  const topicData = currentTopicData(s);
  if (!topicData) return false;

  return topicData.hasMore || topicData.total > topicData.pageSize;
};

const isLoadingMoreTopics = (s: ChatStoreState): boolean =>
  currentTopicData(s)?.isLoadingMore ?? false;

const loadMoreTopicsError = (s: ChatStoreState): unknown => currentTopicData(s)?.loadMoreError;

const isExpandingPageSize = (s: ChatStoreState): boolean =>
  currentTopicData(s)?.isExpandingPageSize ?? false;

// Selectors for the Agent Topics management page's dedicated bucket.
// Always agent-scoped (no group), keyed by `agentId` via `topicMapKey`.
const agentTopicsViewData = (s: ChatStoreState): TopicData | undefined => {
  if (!s.activeAgentId) return undefined;
  return s.agentTopicsViewMap[topicMapKey({ agentId: s.activeAgentId })];
};

const agentTopicsViewTopics = (s: ChatStoreState): ChatTopic[] =>
  agentTopicsViewData(s)?.items ?? [];

const agentTopicsViewHasMore = (s: ChatStoreState): boolean =>
  agentTopicsViewData(s)?.hasMore ?? false;

const agentTopicsViewIsLoadingMore = (s: ChatStoreState): boolean =>
  agentTopicsViewData(s)?.isLoadingMore ?? false;

const agentTopicsViewLoadMoreError = (s: ChatStoreState): unknown =>
  agentTopicsViewData(s)?.loadMoreError;

export const topicSelectors = {
  activeTopicModel,
  agentTopicsViewHasMore,
  agentTopicsViewIsLoadingMore,
  agentTopicsViewLoadMoreError,
  agentTopicsViewTopics,
  currentActiveTopic,
  currentActiveTopicSummary,
  currentTopicCount,
  currentTopicData,
  currentTopicLength,
  currentTopicMetadata,
  currentTopicWorkingDirectory,
  currentTopics,
  currentTopicsWithoutCron,
  currentUnFavTopics,
  displayTopics,
  displayTopicsForSidebar,
  getTopicById,
  getTopicModelById,
  getTopicWorkingDirectory,
  getTopicsByAgentId,
  groupedTopicsForSidebar,
  groupedTopicsSelector,
  hasMoreTopics,
  hasMoreTopicsForSidebar,
  isCreatingTopic,
  isExpandingPageSize,
  isInSearchMode,
  isLoadingMoreTopics,
  isNewTopicSendInFlight,
  isSearchingTopic,
  isUndefinedTopics,
  loadMoreTopicsError,
  searchTopics,
};
