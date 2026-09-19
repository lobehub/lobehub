import type { TaskDetailActivity } from '@lobechat/types';

import { useTaskStore } from '@/store/task';
import { taskActivitySelectors } from '@/store/task/selectors';

export interface LiveRun {
  activity: TaskDetailActivity;
  agentId: string;
  topicId: string;
}

/**
 * The run to stream in the result panel: the task's newest run, while it is
 * still running and has a conversation to open. Once it settles this returns
 * nothing and the panel falls back to reading the report.
 */
export const resolveLiveRun = (activity?: TaskDetailActivity): LiveRun | undefined => {
  if (activity?.status !== 'running' || !activity.id) return;
  const agentId =
    activity.author?.type === 'agent' ? activity.author.id : activity.agentId || undefined;
  if (!agentId) return;
  return { activity, agentId, topicId: activity.id };
};

export const useLiveRun = (): LiveRun | undefined =>
  resolveLiveRun(useTaskStore(taskActivitySelectors.activeTaskLatestTopic));
