'use client';

import { isDesktop } from '@lobechat/const';
import { getWorkingDirEffectivePath } from '@lobechat/types';
import { t } from 'i18next';

import {
  getChatProjection,
  selectChatTopicContainerKeyById,
  selectChatTopicItem,
  selectChatTopicsView,
  useChatTopicProjection,
  useChatTopicsProjectionView,
} from '@/projection';
import type {
  ChatTopic,
  ChatTopicSummary,
  GroupedTopic,
  TopicGroupMode,
  TopicSortBy,
} from '@/types/topic';
import {
  getTopicSortTime,
  groupTopicsByProject,
  groupTopicsByStatus,
  groupTopicsByTime,
  groupTopicsByUpdatedTime,
} from '@/utils/client/topic';

import { getChatStoreState, useChatStore } from '../../store';
import { topicMapKey } from '../../utils/topicMapKey';
import { operationSelectors } from '../operation/selectors';

export const getChatTopicById = (id: string | undefined): ChatTopic | undefined =>
  id ? getChatProjection((scope) => selectChatTopicItem(scope, id)) : undefined;

export const getChatTopicContainerKeyById = (id: string): string | undefined =>
  getChatProjection((scope) => selectChatTopicContainerKeyById(scope, id));

export const getCurrentChatTopic = (): ChatTopic | undefined =>
  getChatTopicById(getChatStoreState().activeTopicId);

export const getChatTopics = (
  containerKey: string,
  surface: 'agentView' | 'sidebar' = 'sidebar',
): ChatTopic[] | undefined =>
  getChatProjection((scope) => selectChatTopicsView(scope, surface, containerKey)?.items);

export const getCurrentChatTopics = (): ChatTopic[] | undefined => {
  const { activeAgentId, activeGroupId } = getChatStoreState();
  if (!activeAgentId && !activeGroupId) return undefined;
  return getChatTopics(topicMapKey({ agentId: activeAgentId, groupId: activeGroupId }));
};

export const getChatTopicsByAgentId = (agentId: string): ChatTopic[] | undefined =>
  getChatTopics(topicMapKey({ agentId }));

export const getChatTopicModelById = (
  id: string | undefined,
): { model: string; provider: string } | undefined => {
  const topic = getChatTopicById(id);
  if (!topic?.model) return undefined;
  return { model: topic.model, provider: topic.provider || '' };
};

export const extractChatTopicWorkingDirectory = (
  topic: ChatTopic | undefined,
): string | undefined => {
  if (!topic) return undefined;
  if (isDesktop) {
    return getWorkingDirEffectivePath(
      topic.metadata?.workingDirectoryConfig ?? topic.metadata?.workingDirectory,
    );
  }

  const metadata = topic.metadata;
  return (
    metadata?.repos?.[0] ??
    getWorkingDirEffectivePath(metadata?.workingDirectoryConfig ?? metadata?.workingDirectory)
  );
};

export const getChatTopicWorkingDirectory = (id?: string | null): string | undefined =>
  id === null
    ? undefined
    : extractChatTopicWorkingDirectory(id ? getChatTopicById(id) : getCurrentChatTopic());

export const useChatTopicById = (id: string | undefined) => useChatTopicProjection(id);

export const useCurrentChatTopic = () => {
  const activeTopicId = useChatStore((state) => state.activeTopicId);
  return useChatTopicProjection(activeTopicId);
};

export const useChatTopics = (
  containerKey: string | undefined,
  surface: 'agentView' | 'sidebar' = 'sidebar',
) => useChatTopicsProjectionView(surface, containerKey);

export const useCurrentChatTopics = () => {
  const [activeAgentId, activeGroupId] = useChatStore((state) => [
    state.activeAgentId,
    state.activeGroupId,
  ]);
  const containerKey =
    activeAgentId || activeGroupId
      ? topicMapKey({ agentId: activeAgentId, groupId: activeGroupId })
      : undefined;
  return useChatTopicsProjectionView('sidebar', containerKey);
};

export const useChatTopicsByAgentId = (agentId: string | undefined) =>
  useChatTopicsProjectionView('sidebar', agentId ? topicMapKey({ agentId }) : undefined);

export const useCurrentChatTopicMetadata = () => useCurrentChatTopic()?.metadata;

export const useActiveChatTopicModel = (): { model: string; provider: string } | undefined => {
  const topic = useCurrentChatTopic();
  if (!topic?.model) return undefined;
  return { model: topic.model, provider: topic.provider || '' };
};

export const useChatTopicWorkingDirectory = (id?: string | null): string | undefined => {
  const activeTopicId = useChatStore((state) => state.activeTopicId);
  const topic = useChatTopicProjection(id === null ? undefined : (id ?? activeTopicId));
  return id === null ? undefined : extractChatTopicWorkingDirectory(topic);
};

export const chatTopicSummary = (topic: ChatTopic | undefined): ChatTopicSummary | undefined =>
  topic
    ? {
        content: topic.historySummary || '',
        model: topic.metadata?.model || '',
        provider: topic.metadata?.provider || '',
      }
    : undefined;

export const topicsWithoutCron = (topics: ChatTopic[] | undefined): ChatTopic[] | undefined =>
  topics?.filter((topic) => topic.trigger !== 'cron');

const sortTopics = (topics: ChatTopic[], sortBy: TopicSortBy): ChatTopic[] => {
  const field = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
  return [...topics].sort((a, b) => getTopicSortTime(b, field) - getTopicSortTime(a, field));
};

export const displayChatTopicsForSidebar = (
  topics: ChatTopic[] | undefined,
  pageSize: number,
  sortBy: TopicSortBy = 'updatedAt',
  includeCompleted = true,
): ChatTopic[] | undefined => {
  const available = topicsWithoutCron(topics);
  if (!available) return undefined;
  const visible = includeCompleted
    ? available
    : available.filter((topic) => topic.status !== 'completed');
  const favorites = visible.filter((topic) => topic.favorite);
  const rest = visible.filter((topic) => !topic.favorite);
  return [...sortTopics(favorites, sortBy), ...sortTopics(rest, sortBy)].slice(0, pageSize);
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

const buildGroupedTopics = (
  topics: ChatTopic[],
  groupFn: (topics: ChatTopic[]) => GroupedTopic[],
): GroupedTopic[] => {
  const favorites = topics.filter((topic) => topic.favorite);
  const rest = topics.filter((topic) => !topic.favorite);
  return favorites.length > 0
    ? [
        { children: favorites, id: 'favorite', title: t('favorite', { ns: 'topic' }) },
        ...groupFn(rest),
      ]
    : groupFn(topics);
};

export const groupChatTopicsForSidebar = (
  topics: ChatTopic[] | undefined,
  pageSize: number,
  sortBy: TopicSortBy = 'updatedAt',
  groupMode: TopicGroupMode = 'byTime',
  includeCompleted = true,
  loadingTopicIds?: ReadonlySet<string>,
): GroupedTopic[] => {
  const visible = displayChatTopicsForSidebar(topics, pageSize, sortBy, includeCompleted);
  if (!visible) return [];
  return buildGroupedTopics(visible, getGroupFn(groupMode, sortBy, loadingTopicIds));
};

export const useGroupedChatTopicsForSidebar = (
  pageSize: number,
  sortBy: TopicSortBy = 'updatedAt',
  groupMode: TopicGroupMode = 'byTime',
  includeCompleted = true,
): GroupedTopic[] => {
  const view = useCurrentChatTopics();
  const loadingTopicIds = useChatStore(
    groupMode === 'byStatus' ? operationSelectors.visiblyRunningTopicIds : () => undefined,
  );
  return groupChatTopicsForSidebar(
    view?.items,
    pageSize,
    sortBy,
    groupMode,
    includeCompleted,
    loadingTopicIds,
  );
};
