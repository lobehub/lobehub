import type { MovableProjectTopic } from '@lobechat/types';

export type MovableTopic = MovableProjectTopic;

export interface MovableTopicGroup {
  agentAvatar: string | null;
  agentBackgroundColor: string | null;
  agentId: string;
  agentTitle: string | null;
  topics: MovableTopic[];
}

/**
 * Group the movable conversations by agent — the "group" a user files into a
 * project in one go — keeping the server's newest-first order inside a group
 * and ordering groups by their newest conversation.
 */
export const groupMovableTopics = (topics: MovableTopic[], keyword = ''): MovableTopicGroup[] => {
  const needle = keyword.trim().toLowerCase();
  const groups = new Map<string, MovableTopicGroup>();
  for (const topic of topics) {
    if (!topic.agentId) continue;
    if (needle && !(topic.title ?? '').toLowerCase().includes(needle)) continue;
    let group = groups.get(topic.agentId);
    if (!group) {
      group = {
        agentAvatar: topic.agentAvatar,
        agentBackgroundColor: topic.agentBackgroundColor,
        agentId: topic.agentId,
        agentTitle: topic.agentTitle,
        topics: [],
      };
      groups.set(topic.agentId, group);
    }
    group.topics.push(topic);
  }
  return [...groups.values()];
};

export type GroupCheckState = 'all' | 'none' | 'some';

export const groupCheckState = (
  group: MovableTopicGroup,
  selected: ReadonlySet<string>,
): GroupCheckState => {
  const count = group.topics.filter((topic) => selected.has(topic.id)).length;
  return count === 0 ? 'none' : count === group.topics.length ? 'all' : 'some';
};

/** Select the whole group, or clear it when it is already fully selected. */
export const toggleGroup = (
  group: MovableTopicGroup,
  selected: ReadonlySet<string>,
): Set<string> => {
  const next = new Set(selected);
  const selectAll = groupCheckState(group, selected) !== 'all';
  for (const topic of group.topics) {
    if (selectAll) next.add(topic.id);
    else next.delete(topic.id);
  }
  return next;
};

export const toggleTopic = (id: string, selected: ReadonlySet<string>): Set<string> => {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};
