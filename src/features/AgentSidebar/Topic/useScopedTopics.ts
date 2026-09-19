import { useMemo } from 'react';

import { MAIN_SIDEBAR_EXCLUDE_TRIGGERS } from '@/const/topic';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { groupSidebarTopics, selectSidebarTopics } from '@/store/chat/slices/topic/selectors';
import { useGlobalStore } from '@/store/global';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';
import type { ChatTopic, TopicGroupMode, TopicSortBy } from '@/types/topic';

import { useTopicListScope } from './TopicListScope';

export const useScopedTopics = () => {
  const scope = useTopicListScope();
  const request = useProjectDirectoryStore((s) => s.useFetchProjectTopics)(scope?.projectId);
  const topics = useMemo(
    () =>
      request.data?.data.map((topic) => ({
        ...topic,
        createdAt: new Date(topic.createdAt).getTime(),
        updatedAt: new Date(topic.updatedAt).getTime(),
        favorite: topic.favorite ?? false,
        metadata: topic.metadata ?? undefined,
        title: topic.title ?? '',
      })),
    [request.data],
  );
  return { scope, topics, refresh: request.mutate };
};

export const useScopedTopic = (id?: string) =>
  useScopedTopics().topics?.find((topic) => topic.id === id);

export const useScopedSidebarTopics = (
  pageSize: number,
  sortBy: TopicSortBy,
  groupMode: TopicGroupMode,
  includeCompleted: boolean,
) => {
  const { scope, topics } = useScopedTopics();
  const { topicId } = useActiveRouteParams<{ topicId?: string }>();
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const running = useChatStore(operationSelectors.visiblyRunningTopicIds);
  const visible = useMemo(() => {
    const list: ChatTopic[] = (topics ?? []).filter(
      (topic) => !topic.trigger || !MAIN_SIDEBAR_EXCLUDE_TRIGGERS.includes(topic.trigger),
    );
    return selectSidebarTopics(
      list,
      pageSize,
      sortBy,
      includeCompleted,
      list.find((topic) => topic.id === topicId),
    );
  }, [topics, topicId, pageSize, sortBy, includeCompleted]);
  const groups = useMemo(
    () => groupSidebarTopics(visible, groupMode, sortBy, running),
    [visible, groupMode, sortBy, running],
  );
  const hasMore =
    (topics ?? []).filter(
      (topic) =>
        (!topic.trigger || !MAIN_SIDEBAR_EXCLUDE_TRIGGERS.includes(topic.trigger)) &&
        (includeCompleted || topic.status !== 'completed'),
    ).length > pageSize;
  return {
    scope,
    topics: visible,
    groups,
    activeTopicId: topicId,
    hasMore,
    loadMore: () => updateSystemStatus({ topicPageSize: pageSize + 20 }),
  };
};
