import type {
  AgentAvailableIndex,
  AgentDirectoryIndex,
  AgentSearchIndex,
  BriefNewsIndex,
  ChatGroupListIndex,
  ChatTopicsIndex,
  HomeInboxTopicsIndex,
  HomeRecentTopicsIndex,
  HomeSidebarIndex,
  HomeTasksIndex,
  HomeUnresolvedBriefsIndex,
  ProjectionIndex,
  ProjectionKind,
  TaskGroupListIndex,
  TaskListIndex,
} from '@lobechat/types';

const removeFlatRefs = <T extends { id: string }>(refs: T[], ids: ReadonlySet<string>): T[] =>
  refs.filter((ref) => !ids.has(ref.id));

const removedCount = <T extends { id: string }>(refs: T[], ids: ReadonlySet<string>): number =>
  refs.reduce((count, ref) => count + Number(ids.has(ref.id)), 0);

/**
 * Removes an entity from every list shape owned by the Projection registry.
 * The record action remains independent from the query that happened to expose
 * the entity, so deletes cannot leave durable indexes pointing at tombstones.
 */
export const removeEntityFromProjectionIndex = (
  index: ProjectionIndex,
  kind: ProjectionKind,
  ids: ReadonlySet<string>,
  observedAt: number,
): ProjectionIndex | undefined => {
  const mutation = { observedAt, source: 'mutation' as const };

  if (kind === 'agent' && index.key === 'agent.available') {
    const list = index as AgentAvailableIndex;
    if (removedCount(list.refs, ids) === 0) return undefined;
    return { ...list, ...mutation, refs: removeFlatRefs(list.refs, ids) };
  }

  if (kind === 'agent' && index.key === 'agent.directory') {
    const list = index as AgentDirectoryIndex;
    if (removedCount(list.refs, ids) === 0) return undefined;
    return { ...list, ...mutation, refs: removeFlatRefs(list.refs, ids) };
  }

  if ((kind === 'agent' || kind === 'chatGroup') && index.key.startsWith('agent.search:')) {
    const list = index as AgentSearchIndex;
    const refs = list.refs.filter((ref) => ref.kind !== kind || !ids.has(ref.id));
    if (refs.length === list.refs.length) return undefined;
    return { ...list, ...mutation, refs };
  }

  if (kind === 'chatGroup' && index.key === 'chatGroup.list') {
    const list = index as ChatGroupListIndex;
    if (removedCount(list.refs, ids) === 0) return undefined;
    return { ...list, ...mutation, refs: removeFlatRefs(list.refs, ids) };
  }

  if ((kind === 'agent' || kind === 'chatGroup') && index.key === 'home.sidebar') {
    const sidebar = index as HomeSidebarIndex;
    const matches = (ref: { id: string; kind: string }) => ref.kind === kind && ids.has(ref.id);
    const groups = sidebar.groups.map((group) => ({
      ...group,
      items: group.items.filter((ref) => !matches(ref)),
    }));
    const privateGroups = sidebar.privateGroups.map((group) => ({
      ...group,
      items: group.items.filter((ref) => !matches(ref)),
    }));
    const changed = [
      ...sidebar.pinned,
      ...sidebar.ungrouped,
      ...sidebar.privatePinned,
      ...sidebar.privateUngrouped,
      ...sidebar.groups.flatMap((group) => group.items),
      ...sidebar.privateGroups.flatMap((group) => group.items),
    ].some(matches);
    if (!changed) return undefined;
    return {
      ...sidebar,
      ...mutation,
      groups,
      pinned: sidebar.pinned.filter((ref) => !matches(ref)),
      privateGroups,
      privatePinned: sidebar.privatePinned.filter((ref) => !matches(ref)),
      privateUngrouped: sidebar.privateUngrouped.filter((ref) => !matches(ref)),
      ungrouped: sidebar.ungrouped.filter((ref) => !matches(ref)),
    };
  }

  if (kind === 'topic' && index.key.startsWith('chat.')) {
    const list = index as ChatTopicsIndex;
    const count = removedCount(list.refs, ids);
    if (count === 0) return undefined;
    return {
      ...list,
      ...mutation,
      refs: removeFlatRefs(list.refs, ids),
      total: Math.max(0, list.total - count),
    };
  }

  if (kind === 'topic' && index.key === 'home.inboxTopics') {
    const list = index as HomeInboxTopicsIndex;
    if (removedCount(list.refs, ids) === 0) return undefined;
    return { ...list, ...mutation, refs: removeFlatRefs(list.refs, ids) };
  }

  if (kind === 'topic' && index.key === 'home.recentTopics') {
    const list = index as HomeRecentTopicsIndex;
    if (removedCount(list.refs, ids) === 0) return undefined;
    return { ...list, ...mutation, refs: removeFlatRefs(list.refs, ids) };
  }

  if (kind === 'task' && index.key.startsWith('task.list:')) {
    const list = index as TaskListIndex;
    const count = removedCount(list.refs, ids);
    if (count === 0) return undefined;
    return {
      ...list,
      ...mutation,
      refs: removeFlatRefs(list.refs, ids),
      total: Math.max(0, list.total - count),
    };
  }

  if (kind === 'task' && index.key.startsWith('task.groupList:')) {
    const list = index as TaskGroupListIndex;
    let changed = false;
    const groups = list.groups.map((group) => {
      const count = removedCount(group.refs, ids);
      if (count === 0) return group;
      changed = true;
      return {
        ...group,
        refs: removeFlatRefs(group.refs, ids),
        total: Math.max(0, group.total - count),
      };
    });
    return changed ? { ...list, ...mutation, groups } : undefined;
  }

  if (kind === 'task' && index.key === 'home.tasks') {
    const list = index as HomeTasksIndex;
    const count = removedCount(list.refs, ids);
    if (count === 0) return undefined;
    return {
      ...list,
      ...mutation,
      refs: removeFlatRefs(list.refs, ids),
      total: Math.max(0, list.total - count),
    };
  }

  if (kind === 'brief' && index.key.startsWith('brief.news:')) {
    const list = index as BriefNewsIndex;
    if (removedCount(list.refs, ids) === 0) return undefined;
    return { ...list, ...mutation, refs: removeFlatRefs(list.refs, ids) };
  }

  if (kind === 'brief' && index.key === 'home.unresolvedBriefs') {
    const list = index as HomeUnresolvedBriefsIndex;
    if (removedCount(list.refs, ids) === 0) return undefined;
    return { ...list, ...mutation, refs: removeFlatRefs(list.refs, ids) };
  }

  return undefined;
};
