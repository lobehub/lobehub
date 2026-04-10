import { isDesktop } from '@lobechat/const';
import { t } from 'i18next';

import {
  type ChatTopic,
  type ChatTopicSummary,
  type GroupedTopic,
  TopicDisplayMode,
} from '@/types/topic';
import { groupTopicsByTime, groupTopicsByUpdatedTime } from '@/utils/client/topic';

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

/**
 * Get current active topic's working directory
 * Returns undefined if no topic is active or no working directory is set
 */
const currentTopicWorkingDirectory = (s: ChatStoreState): string | undefined => {
  if (!isDesktop) return;

  const activeTopic = currentActiveTopic(s);
  return activeTopic?.metadata?.workingDirectory;
};

const isCreatingTopic = (s: ChatStoreState) => s.creatingTopic;
const isUndefinedTopics = (s: ChatStoreState) => !currentTopics(s);
const isInSearchMode = (s: ChatStoreState) => s.inSearchingMode;
const isSearchingTopic = (s: ChatStoreState) => s.isSearchingTopic;

// Limit topics for sidebar display based on user's page size preference
const displayTopicsForSidebar =
  (pageSize: number) =>
  (s: ChatStoreState): ChatTopic[] | undefined => {
    const topics = currentTopicsWithoutCron(s);
    if (!topics) return undefined;

    // Return only the first page worth of topics for sidebar
    return topics.slice(0, pageSize);
  };

const getGroupFn = (displayMode: TopicDisplayMode) =>
  displayMode === TopicDisplayMode.ByUpdatedTime ? groupTopicsByUpdatedTime : groupTopicsByTime;

/**
 * Build grouped topics from a topic list, splitting favorites into a separate group
 */
const buildGroupedTopics = (
  topics: ChatTopic[],
  groupFn: typeof groupTopicsByTime,
): GroupedTopic[] => {
  const favTopics = topics.filter((topic) => topic.favorite);
  const unfavTopics = topics.filter((topic) => !topic.favorite);

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
  (pageSize: number, displayMode: TopicDisplayMode = TopicDisplayMode.ByCreatedTime) =>
  (s: ChatStoreState): GroupedTopic[] => {
    const limitedTopics = displayTopicsForSidebar(pageSize)(s);
    if (!limitedTopics) return [];
    return buildGroupedTopics(limitedTopics, getGroupFn(displayMode));
  };

const hasMoreTopics = (s: ChatStoreState): boolean => currentTopicData(s)?.hasMore ?? false;

const isLoadingMoreTopics = (s: ChatStoreState): boolean =>
  currentTopicData(s)?.isLoadingMore ?? false;

const isExpandingPageSize = (s: ChatStoreState): boolean =>
  currentTopicData(s)?.isExpandingPageSize ?? false;

export const topicSelectors = {
  currentActiveTopic,
  currentActiveTopicSummary,
  currentTopicCount,
  currentTopicData,
  currentTopicLength,
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
  isCreatingTopic,
  isExpandingPageSize,
  isInSearchMode,
  isLoadingMoreTopics,
  isSearchingTopic,
  isUndefinedTopics,
  searchTopics,
};
