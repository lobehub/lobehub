'use client';

import type { TaskExecutionConfig } from '@lobechat/types';
import { readTaskExecutionConfig } from '@lobechat/types';
import { memo, useCallback, useMemo } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import TaskExecutionControls from '../features/TaskExecutionControls';
import { taskDetailLayoutStyles as styles } from './taskDetailLayoutStyles';

/**
 * Where a task's runs go, on the task detail.
 *
 * Sits in the properties rail's execution group, under the assignee it
 * inherits from and the model it runs: the directory follows from the target,
 * so the three read as one cluster.
 *
 * Read-only members still see it — knowing a task is pinned to another machine
 * is exactly the context they need — with the controls inert.
 */
const TaskExecutionConfig = memo(() => {
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const taskConfig = useTaskStore((s) => taskDetailSelectors.activeTaskDetail(s)?.config);
  const updateTaskExecution = useTaskStore((s) => s.updateTaskExecution);
  const { allowed: canEditTask } = usePermission('create_content');
  const userId = useUserStore(userProfileSelectors.userId);
  const createdByUserId = useTaskStore(taskDetailSelectors.activeTaskCreatedByUserId);

  // Derived from the raw `config` reference so the reader runs once per config
  // change: it builds a fresh object, which as a store selector would report a
  // change on every unrelated update.
  const execution = useMemo(() => readTaskExecutionConfig(taskConfig), [taskConfig]);

  const handleChange = useCallback(
    (next?: TaskExecutionConfig) => {
      if (taskId) void updateTaskExecution(taskId, next);
    },
    [taskId, updateTaskExecution],
  );

  if (!assigneeAgentId) return null;

  // Keyed per task: a "not following" state with nothing picked yet belongs to
  // the task it was set on, not to the next one opened in this view.
  return (
    <TaskExecutionControls
      assigneeAgentId={assigneeAgentId}
      canPinPrivateDevices={!!userId && createdByUserId === userId}
      chipClassName={styles.propertyItem}
      disabled={!canEditTask}
      key={taskId}
      value={execution}
      onChange={handleChange}
    />
  );
});

TaskExecutionConfig.displayName = 'TaskExecutionConfig';

export default TaskExecutionConfig;
