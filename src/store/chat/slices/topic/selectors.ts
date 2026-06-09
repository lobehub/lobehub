import { isDesktop } from '@lobechat/const';
import { t } from 'i18next';

import {
  type ChatTopic,
  type ChatTopicSummary,
  type GroupedTopic,
  type TopicGroupMode,
  type TopicSortBy,
} from '@/types/topic';
import {
  groupTopicsByProject,
  groupTopicsByStatus,
  groupTopicsByTime,
  groupTopicsByUpdatedTime,
} from '@/utils/client/topic';

import { type ChatStoreState } from '../../initialState';
import { topicMapKey } from '../../utils/topicMapKey';
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
 * Get current active topic's working directory.
 * On desktop: local filesystem path.
 * On web (cloud): primary GitHub repo URL (repos[0]), or workingDirectory if set directly.
 */
const currentTopicWorkingDirectory = (s: ChatStoreState): string | undefined => {
  const activeTopic = currentActiveTopic(s);
  if (!activeTopic) return;

  if (isDesktop) return activeTopic.metadata?.workingDirectory;

  // Web: return primary repo from repos list, or workingDirectory if set directly
  const meta = activeTopic.metadata;
  return meta?.repos?.[0] ?? meta?.workingDirectory;
};

const isCreatingTopic = (s: ChatStoreState) => s.creatingTopic;
const isUndefinedTopics = (s: ChatStoreState) => !currentTopics(s);
const isInSearchMode = (s: ChatStoreState) => s.inSearchingMode;
const isSearchingTopic = (s: ChatStoreState) => s.isSearchingTopic;

const sortTopics = (topics: ChatTopic[], sortBy: TopicSortBy): ChatTopic[] => {
  const field = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
  return [...topics].sort((a, b) => b[field] - a[field]);
};

// Limit topics for sidebar display based on user's page size preference
const displayTopicsForSidebar =
  (pageSize: number, sortBy: TopicSortBy = 'updatedAt') =>
  (s: ChatStoreState): ChatTopic[] | undefined => {
    const topics = currentTopicsWithoutCron(s);
    if (!topics) return undefined;

    // Favorites first, then sorted by the chosen timestamp, then page-sliced
    const favTopics = topics.filter((t) => t.favorite);
    const rest = topics.filter((t) => !t.favorite);
    return [...sortTopics(favTopics, sortBy), ...sortTopics(rest, sortBy)].slice(0, pageSize);
  };

const getGroupFn = (
  groupMode: TopicGroupMode,
  sortBy: TopicSortBy,
  loadingTopicIds?: ReadonlySet<string>,
  unreadTopicIds?: ReadonlySet<string>,
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
      groupTopicsByStatus(topics, field, loadingTopicIds, unreadTopicIds).map((group) => ({
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
  (pageSize: number, sortBy: TopicSortBy = 'updatedAt', groupMode: TopicGroupMode = 'byTime') =>
  (s: ChatStoreState): GroupedTopic[] => {
    const limitedTopics = displayTopicsForSidebar(pageSize, sortBy)(s);
    if (!limitedTopics) return [];
    // Topics actively streaming on this client surface under "running", and
    // topics with an unread completion surface under "pending", even though
    // their persisted status says otherwise — see resolveStatusBucket. Both are
    // client-only states the server can't see.
    const loadingTopicIds = groupMode === 'byStatus' ? new Set(s.topicLoadingIds) : undefined;
    const unreadTopicIds =
      groupMode === 'byStatus'
        ? new Set(Object.values(s.unreadCompletedTopicsByAgent).flatMap((set) => [...set]))
        : undefined;
    return buildGroupedTopics(
      limitedTopics,
      getGroupFn(groupMode, sortBy, loadingTopicIds, unreadTopicIds),
    );
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

export const topicSelectors = {
  agentTopicsViewHasMore,
  agentTopicsViewIsLoadingMore,
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
  getTopicsByAgentId,
  groupedTopicsForSidebar,
  groupedTopicsSelector,
  hasMoreTopics,
  hasMoreTopicsForSidebar,
  isCreatingTopic,
  isExpandingPageSize,
  isInSearchMode,
  isLoadingMoreTopics,
  isSearchingTopic,
  isUndefinedTopics,
  searchTopics,
};
