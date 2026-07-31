'use client';

import type {
  ChatTopicStatus,
  HomeAgentFragments,
  HomeInboxTopicsIndex,
  HomeRecentTopicsIndex,
  HomeRecentTopicsView,
  HomeSidebarEntityRef,
  HomeSidebarIndex,
  HomeTasksIndex,
  HomeUnresolvedBriefsIndex,
  SidebarAgentItem,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';
import { shallow } from 'zustand/shallow';

import { useCacheScope } from '@/libs/swr/useCacheScope';

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
import { useEntityStore } from './store';

export const useHomeSidebarIndex = (
  isVisible?: (item: SidebarAgentItem) => boolean,
): HomeSidebarIndex | undefined => {
  const scope = useCacheScope();

  return useEntityStore((state) => {
    const entityScope = state.scopes[scope];
    const index = entityScope?.indexes['home.sidebar'];
    if (!entityScope || index?.key !== 'home.sidebar' || !selectHomeSidebar(entityScope)) {
      return undefined;
    }
    if (!isVisible) return index;

    const filter = (refs: HomeSidebarEntityRef[]) =>
      refs.filter((ref) => {
        const item = selectHomeSidebarItem(entityScope, ref);
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

export const useHomeSidebarItem = (ref: HomeSidebarEntityRef | undefined) => {
  const scope = useCacheScope();

  return useEntityStore((state) => {
    const entityScope = state.scopes[scope];
    return entityScope && ref ? selectHomeSidebarItem(entityScope, ref) : undefined;
  }, shallow);
};

export const useHomeAgentIdentity = (
  id: string | undefined,
): HomeAgentFragments['identity'] | undefined => {
  const scope = useCacheScope();

  return useEntityStore(
    (state) => (id ? state.scopes[scope]?.entities.agent[id]?.fragments.identity?.data : undefined),
    shallow,
  );
};

export const useHomeRecentTopicsIndex = (): HomeRecentTopicsIndex | undefined => {
  const scope = useCacheScope();

  return useEntityStore((state) => {
    const index = state.scopes[scope]?.indexes['home.recentTopics'];
    return index?.key === 'home.recentTopics' ? index : undefined;
  });
};

export const useHomeRecentTopicIds = (
  limit: number,
  view: HomeRecentTopicsView = 'mine',
): string[] => {
  const scope = useCacheScope();

  return useEntityStore((state) => {
    const entityScope = state.scopes[scope];
    const index = entityScope?.indexes['home.recentTopics'];
    if (
      !entityScope ||
      index?.key !== 'home.recentTopics' ||
      index.limit < limit ||
      index.view !== view
    )
      return [];
    return index.refs
      .slice(0, limit)
      .filter((ref) => Boolean(selectHomeRecentTopic(entityScope.entities.topic[ref.id])))
      .map((ref) => ref.id);
  }, shallow);
};

export const useHomeRecentTopic = (id: string | undefined) => {
  const scope = useCacheScope();
  const record = useEntityStore((state) =>
    id ? state.scopes[scope]?.entities.topic[id] : undefined,
  );

  return useMemo(() => selectHomeRecentTopic(record), [record]);
};

export const useHomeInboxTopicsIndex = (): HomeInboxTopicsIndex | undefined => {
  const scope = useCacheScope();

  return useEntityStore((state) => {
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

  return useEntityStore((state) => {
    const entityScope = state.scopes[scope];
    const index = entityScope?.indexes['home.inboxTopics'];
    if (!entityScope || index?.key !== 'home.inboxTopics') return [];

    const ids: string[] = [];
    for (const ref of index.refs) {
      const record = entityScope.entities.topic[ref.id];
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
  const record = useEntityStore((state) =>
    id ? state.scopes[scope]?.entities.topic[id] : undefined,
  );

  return useMemo(() => selectHomeInboxTopic(record), [record]);
};

export const useHomeInboxAgentIds = (topicIds: readonly string[]): string[] => {
  const scope = useCacheScope();

  return useEntityStore((state) => {
    const topics = state.scopes[scope]?.entities.topic;
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

  return useEntityStore((state) => {
    const index = state.scopes[scope]?.indexes['home.tasks'];
    return index?.key === 'home.tasks' ? index : undefined;
  });
};

export const useHomeTaskIds = (limit?: number): string[] => {
  const scope = useCacheScope();

  return useEntityStore((state) => {
    const entityScope = state.scopes[scope];
    const index = entityScope?.indexes['home.tasks'];
    if (!entityScope || index?.key !== 'home.tasks') return [];

    const ids = index.refs
      .filter((ref) => Boolean(selectHomeTask(entityScope.entities.task[ref.id])))
      .map((ref) => ref.id);
    return limit === undefined ? ids : ids.slice(0, limit);
  }, shallow);
};

export const useHomeTask = (id: string | undefined) => {
  const scope = useCacheScope();
  const record = useEntityStore((state) =>
    id ? state.scopes[scope]?.entities.task[id] : undefined,
  );

  return useMemo(() => selectHomeTask(record), [record]);
};

export const useHomeBriefsIndex = (): HomeUnresolvedBriefsIndex | undefined => {
  const scope = useCacheScope();

  return useEntityStore((state) => {
    const index = state.scopes[scope]?.indexes['home.unresolvedBriefs'];
    return index?.key === 'home.unresolvedBriefs' ? index : undefined;
  });
};

export const useHomeBriefIds = (section?: HomeBriefSection): string[] => {
  const scope = useCacheScope();

  return useEntityStore((state) => {
    const entityScope = state.scopes[scope];
    const index = entityScope?.indexes['home.unresolvedBriefs'];
    if (!entityScope || index?.key !== 'home.unresolvedBriefs') return [];

    const briefs = index.refs.flatMap((ref) => {
      const record = entityScope.entities.brief[ref.id];
      if (record?.tombstoneAt && record.tombstoneAt >= index.observedAt) return [];
      const relations = record?.fragments.relations?.data;
      const brief = selectHomeBrief(
        record,
        relations?.agentId ? entityScope.entities.agent[relations.agentId] : undefined,
        relations?.taskId ? entityScope.entities.task[relations.taskId] : undefined,
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
  const [record, agentRecord, taskRecord] = useEntityStore((state) => {
    const entityScope = state.scopes[scope];
    const briefRecord = id ? entityScope?.entities.brief[id] : undefined;
    const relations = briefRecord?.fragments.relations?.data;
    return [
      briefRecord,
      relations?.agentId ? entityScope?.entities.agent[relations.agentId] : undefined,
      relations?.taskId ? entityScope?.entities.task[relations.taskId] : undefined,
    ] as const;
  }, shallow);

  return useMemo(
    () => selectHomeBrief(record, agentRecord, taskRecord),
    [agentRecord, record, taskRecord],
  );
};
