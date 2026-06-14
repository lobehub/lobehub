import { type TaskItem } from '@lobechat/types';
import { useMemo } from 'react';

import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';

import { type FleetColumn, fleetColumnKey } from './types';

const toColumn = (task: TaskItem): FleetColumn | null => {
  if (!task.assigneeAgentId) return null;
  return {
    agentId: task.assigneeAgentId,
    fallbackTitle: task.name || task.identifier,
    key: fleetColumnKey(task.assigneeAgentId, task.currentTopicId),
    taskIdentifier: task.identifier,
    threadId: null,
    topicId: task.currentTopicId,
  };
};

/**
 * Account-wide source of "working" agents. Reads the running task group
 * (status running/scheduled) across every agent and exposes both the raw
 * tasks (for the sidebar) and the derived default columns (for the board),
 * plus a key→task map so a column can render live status/title.
 */
export const useRunningTasks = () => {
  const useFetchTaskGroupList = useTaskStore((s) => s.useFetchTaskGroupList);
  useFetchTaskGroupList({ allAgents: true });

  const runningTasks = useTaskStore(taskListSelectors.runningTasks);
  const isInit = useTaskStore(taskListSelectors.isTaskGroupListInit);

  const columns = useMemo(
    () => runningTasks.map(toColumn).filter((c): c is FleetColumn => Boolean(c)),
    [runningTasks],
  );

  const taskByColumnKey = useMemo(() => {
    const map: Record<string, TaskItem> = {};
    for (const task of runningTasks) {
      if (!task.assigneeAgentId) continue;
      map[fleetColumnKey(task.assigneeAgentId, task.currentTopicId)] = task;
    }
    return map;
  }, [runningTasks]);

  return { columns, isInit, runningTasks, taskByColumnKey };
};
