'use client';

import type { TaskExecutionConfig } from '@lobechat/types';
import { readTaskExecutionConfig } from '@lobechat/types';
import { memo, useCallback, useMemo } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import TaskExecutionControls from '../features/TaskExecutionControls';

/**
 * Where a task's runs go, on the task detail.
 *
 * Sits in the header's main column next to the assignee it inherits from, not
 * in the properties rail: the run location is what the run action above it will
 * do, and the directory follows from that target, so the three read as one
 * cluster. The rail keeps the independent properties (status, priority,
 * visibility, schedule).
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

  return (
    <TaskExecutionControls
      assigneeAgentId={assigneeAgentId}
      disabled={!canEditTask}
      value={execution}
      onChange={handleChange}
    />
  );
});

TaskExecutionConfig.displayName = 'TaskExecutionConfig';

export default TaskExecutionConfig;
