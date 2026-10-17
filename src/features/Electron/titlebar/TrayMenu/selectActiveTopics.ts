import type { TrayActiveTopicItem } from '@lobechat/electron-client-ipc';

import type { ChatStoreState } from '@/store/chat/initialState';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import type { ChatTopic } from '@/types/topic';

interface TopicOwner {
  agentId?: string;
  groupId?: string;
}

export interface ActiveTopic extends TopicOwner {
  status: TrayActiveTopicItem['status'];
  title: string;
  topicId: string;
}

// `group_agent_{groupId}_{agentId}` cannot be split because ids contain underscores.
const ownerFromBucketKey = (key: string): TopicOwner | undefined => {
  if (key.startsWith('group_agent_')) return;
  if (key.startsWith('group_')) return { groupId: key.slice('group_'.length) };
  if (key.startsWith('agent_')) {
    const agentId = key.slice('agent_'.length);
    if (agentId && agentId !== 'undefined') return { agentId };
  }
};

export const selectActiveTopics = (s: ChatStoreState): ActiveTopic[] => {
  const runningIds = operationSelectors.visiblyRunningTopicIds(s);
  const candidates = new Map<string, { owner?: TopicOwner; topic: ChatTopic }>();

  for (const [key, data] of Object.entries(s.topicDataMap)) {
    for (const topic of data.items ?? []) {
      if (candidates.has(topic.id)) continue;
      if (
        topic.status === 'running' ||
        topic.status === 'waitingForHuman' ||
        runningIds.has(topic.id)
      ) {
        candidates.set(topic.id, { owner: ownerFromBucketKey(key), topic });
      }
    }
  }
  for (const topicId of runningIds) {
    const topic = s.topicDetailMap[topicId];
    if (topic && !candidates.has(topicId)) candidates.set(topicId, { topic });
  }
  if (candidates.size === 0) return [];

  const opOwners = new Map<string, TopicOwner>();
  for (const op of Object.values(s.operations)) {
    const { agentId, groupId, topicId } = op.context;
    if (topicId && candidates.has(topicId) && (agentId || groupId)) {
      opOwners.set(topicId, { agentId, groupId });
    }
  }

  const result: ActiveTopic[] = [];
  for (const [topicId, { owner, topic }] of candidates) {
    const resolvedOwner = opOwners.get(topicId) ?? owner;
    if (!resolvedOwner) continue;
    result.push({
      ...resolvedOwner,
      status: topic.status === 'waitingForHuman' ? 'waitingForHuman' : 'running',
      title: topic.title,
      topicId,
    });
  }

  return result;
};
