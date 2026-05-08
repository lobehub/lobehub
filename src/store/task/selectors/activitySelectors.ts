import type { TaskDetailActivity } from '@lobechat/types';

import type { TaskStoreState } from '../initialState';
import { taskDetailSelectors } from './detailSelectors';

const activeTaskActivities = (s: TaskStoreState): TaskDetailActivity[] => {
  const detail = taskDetailSelectors.activeTaskDetail(s);
  if (!detail?.activities) return [];

  return [...detail.activities].sort((a, b) => {
    const timeA = a.time ? new Date(a.time).getTime() : 0;
    const timeB = b.time ? new Date(b.time).getTime() : 0;
    return timeA - timeB;
  });
};

const activeTaskBriefs = (s: TaskStoreState): TaskDetailActivity[] =>
  activeTaskActivities(s).filter((a) => a.type === 'brief');

const activeTaskTopics = (s: TaskStoreState): TaskDetailActivity[] =>
  activeTaskActivities(s).filter((a) => a.type === 'topic');

const activeTaskComments = (s: TaskStoreState): TaskDetailActivity[] =>
  activeTaskActivities(s).filter((a) => a.type === 'comment');

const unresolvedBriefCount = (s: TaskStoreState): number =>
  activeTaskBriefs(s).filter((b) => !b.resolvedAction).length;

const hasUnresolvedBriefs = (s: TaskStoreState): boolean => unresolvedBriefCount(s) > 0;

const activeDrawerTopicActivity = (s: TaskStoreState): TaskDetailActivity | undefined => {
  const topicId = s.activeTopicDrawerTopicId;
  if (!topicId) return undefined;
  return activeTaskTopics(s).find((a) => a.id === topicId);
};

export const taskActivitySelectors = {
  activeDrawerTopicActivity,
  activeTaskActivities,
  activeTaskBriefs,
  activeTaskComments,
  activeTaskTopics,
  hasUnresolvedBriefs,
  unresolvedBriefCount,
};
