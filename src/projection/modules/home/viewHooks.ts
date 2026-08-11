'use client';

import type {
  AgentProjectionFragments,
  ChatTopicStatus,
  HomeInboxTopicsIndex,
  HomeRecentTopicsIndex,
  HomeRecentTopicsView,
  HomeSidebarIndex,
  HomeSidebarProjectionRef,
  HomeTasksIndex,
  HomeUnresolvedBriefsIndex,
  SidebarAgentItem,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';
import { shallow } from 'zustand/shallow';

import { useCacheScope } from '@/libs/swr/useCacheScope';

import { useProjectionStore } from '../../store';
import {
  compareHomeNeedsYouBriefs,
  type HomeBriefSection,
  isHomeNewsBrief,
} from './homeBriefSections';
import {
  selectHomeBrief,
  selectHomeInboxTopic,
  selectHomeRecentTopic,
  selectHomeSidebar,
  selectHomeSidebarItem,
  selectHomeTask,
} from './selectors';

export const useHomeSidebarIndex = (
  isVisible?: (item: SidebarAgentItem) => boolean,
): HomeSidebarIndex | undefined => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    const index = projectionScope?.indexes['home.sidebar'];
    if (!projectionScope || index?.key !== 'home.sidebar' || !selectHomeSidebar(projectionScope)) {
      return undefined;
    }
    if (!isVisible) return index;

    const filter = (refs: HomeSidebarProjectionRef[]) =>
      refs.filter((ref) => {
        const item = selectHomeSidebarItem(projectionScope, ref);
        return item ? isVisible(item) : false;
      });
    const filterGroups = (groups: HomeSidebarIndex['groups']) =>
      groups.map((group) => ({ ...group, items: filter(group.items) }));

    return {
      ...index,
      groups: filterGroups(index.groups),
      pinned: filter(index.pinned),
      privateGroups: filterGroups(index.privateGroups),
      privatePinned: filter(index.privatePinned),
      privateUngrouped: filter(index.privateUngrouped),
      ungrouped: filter(index.ungrouped),
    };
  }, isEqual);
};

export const useHomeSidebarItem = (ref: HomeSidebarProjectionRef | undefined) => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    return projectionScope && ref ? selectHomeSidebarItem(projectionScope, ref) : undefined;
  }, shallow);
};

export const useHomeAgentIdentity = (
  id: string | undefined,
): AgentProjectionFragments['identity'] | undefined => {
  const scope = useCacheScope();

  return useProjectionStore(
    (state) => (id ? state.scopes[scope]?.records.agent[id]?.fragments.identity?.data : undefined),
    shallow,
  );
};

export const useHomeRecentTopicsIndex = (): HomeRecentTopicsIndex | undefined => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const index = state.scopes[scope]?.indexes['home.recentTopics'];
    return index?.key === 'home.recentTopics' ? index : undefined;
  });
};

export const useHomeRecentTopicIds = (
  limit: number,
  view: HomeRecentTopicsView = 'mine',
): string[] => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    const index = projectionScope?.indexes['home.recentTopics'];
    if (
      !projectionScope ||
      index?.key !== 'home.recentTopics' ||
      index.limit < limit ||
      index.view !== view
    )
      return [];
    return index.refs
      .slice(0, limit)
      .filter((ref) => Boolean(selectHomeRecentTopic(projectionScope.records.topic[ref.id])))
      .map((ref) => ref.id);
  }, shallow);
};

export const useHomeRecentTopic = (id: string | undefined) => {
  const scope = useCacheScope();
  const record = useProjectionStore((state) =>
    id ? state.scopes[scope]?.records.topic[id] : undefined,
  );

  return useMemo(() => selectHomeRecentTopic(record), [record]);
};

export const useHomeInboxTopicsIndex = (): HomeInboxTopicsIndex | undefined => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const index = state.scopes[scope]?.indexes['home.inboxTopics'];
    return index?.key === 'home.inboxTopics' ? index : undefined;
  });
};

/**
 * `userIdFilter === null` means all owners. `undefined` deliberately matches
 * records whose source omitted userId, preserving the previous mine-filter semantics.
 */
export const useHomeInboxTopicIds = (
  status: ChatTopicStatus,
  userIdFilter: string | null | undefined = null,
  requireAgentId = false,
): string[] => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    const index = projectionScope?.indexes['home.inboxTopics'];
    if (!projectionScope || index?.key !== 'home.inboxTopics') return [];

    const ids: string[] = [];
    for (const ref of index.refs) {
      const record = projectionScope.records.topic[ref.id];
      if (record?.tombstoneAt && record.tombstoneAt >= index.observedAt) continue;
      const topic = selectHomeInboxTopic(record);
      if (!topic || topic.status !== status) continue;
      if (userIdFilter !== null && topic.userId !== userIdFilter) continue;
      if (requireAgentId && !topic.agentId) continue;
      ids.push(topic.id);
    }
    return ids;
  }, shallow);
};

export const useHomeInboxTopic = (id: string | undefined) => {
  const scope = useCacheScope();
  const record = useProjectionStore((state) =>
    id ? state.scopes[scope]?.records.topic[id] : undefined,
  );

  return useMemo(() => selectHomeInboxTopic(record), [record]);
};

export const useHomeInboxAgentIds = (topicIds: readonly string[]): string[] => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const topics = state.scopes[scope]?.records.topic;
    if (!topics) return [];

    const seen = new Set<string>();
    const agentIds: string[] = [];
    for (const topicId of topicIds) {
      const agentId = topics[topicId]?.fragments.routing?.data.agentId;
      if (!agentId || seen.has(agentId)) continue;
      seen.add(agentId);
      agentIds.push(agentId);
    }
    return agentIds;
  }, shallow);
};

export const useHomeTasksIndex = (): HomeTasksIndex | undefined => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const index = state.scopes[scope]?.indexes['home.tasks'];
    return index?.key === 'home.tasks' ? index : undefined;
  });
};

export const useHomeTaskIds = (limit?: number): string[] => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    const index = projectionScope?.indexes['home.tasks'];
    if (!projectionScope || index?.key !== 'home.tasks') return [];

    const ids = index.refs
      .filter((ref) => Boolean(selectHomeTask(projectionScope.records.task[ref.id])))
      .map((ref) => ref.id);
    return limit === undefined ? ids : ids.slice(0, limit);
  }, shallow);
};

export const useHomeTask = (id: string | undefined) => {
  const scope = useCacheScope();
  const record = useProjectionStore((state) =>
    id ? state.scopes[scope]?.records.task[id] : undefined,
  );

  return useMemo(() => selectHomeTask(record), [record]);
};

export const useHomeBriefsIndex = (): HomeUnresolvedBriefsIndex | undefined => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const index = state.scopes[scope]?.indexes['home.unresolvedBriefs'];
    return index?.key === 'home.unresolvedBriefs' ? index : undefined;
  });
};

export const useHomeBriefIds = (section?: HomeBriefSection): string[] => {
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    const index = projectionScope?.indexes['home.unresolvedBriefs'];
    if (!projectionScope || index?.key !== 'home.unresolvedBriefs') return [];

    const briefs = index.refs.flatMap((ref) => {
      const record = projectionScope.records.brief[ref.id];
      if (record?.tombstoneAt && record.tombstoneAt >= index.observedAt) return [];
      const relations = record?.fragments.relations?.data;
      const brief = selectHomeBrief(
        record,
        relations?.agentId ? projectionScope.records.agent[relations.agentId] : undefined,
        relations?.taskId ? projectionScope.records.task[relations.taskId] : undefined,
      );
      return brief ? [brief] : [];
    });

    if (!section) return briefs.map((brief) => brief.id);
    if (section === 'news') return briefs.filter(isHomeNewsBrief).map((brief) => brief.id);

    return briefs
      .filter((brief) => !isHomeNewsBrief(brief))
      .sort(compareHomeNeedsYouBriefs)
      .map((brief) => brief.id);
  }, shallow);
};

export const useHomeBrief = (id: string | undefined) => {
  const scope = useCacheScope();
  const [record, agentRecord, taskRecord] = useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    const briefRecord = id ? projectionScope?.records.brief[id] : undefined;
    const relations = briefRecord?.fragments.relations?.data;
    return [
      briefRecord,
      relations?.agentId ? projectionScope?.records.agent[relations.agentId] : undefined,
      relations?.taskId ? projectionScope?.records.task[relations.taskId] : undefined,
    ] as const;
  }, shallow);

  return useMemo(
    () => selectHomeBrief(record, agentRecord, taskRecord),
    [agentRecord, record, taskRecord],
  );
};
