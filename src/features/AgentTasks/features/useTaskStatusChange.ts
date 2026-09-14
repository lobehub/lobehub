'use client';

import { UNFINISHED_TASK_STATUSES } from '@lobechat/builtin-tool-task';
import type { TaskStatus } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';

import type { TaskStatusCascadeItem } from './TaskStatusCascadeModal';
import { createTaskStatusCascadeModal } from './TaskStatusCascadeModal';

type CascadeTargetStatus = 'canceled' | 'completed';

const CASCADE_TARGET_STATUSES = new Set<TaskStatus>(['canceled', 'completed']);
const UNFINISHED_SUBTASK_STATUSES = new Set<TaskStatus>(UNFINISHED_TASK_STATUSES);

const isCascadeTargetStatus = (status: TaskStatus): status is CascadeTargetStatus =>
  CASCADE_TARGET_STATUSES.has(status);

export const getOpenSubtasks = (subtasks: TaskStatusCascadeItem[]): TaskStatusCascadeItem[] =>
  subtasks.filter((task) => UNFINISHED_SUBTASK_STATUSES.has(task.status as TaskStatus));

export const useTaskStatusChange = () => {
  const { t } = useTranslation('chat');
  const refreshTaskDetail = useTaskStore((s) => s.internal_refreshTaskDetail);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);

  return useCallback(
    async (taskIdentifier: string, status: TaskStatus): Promise<boolean> => {
      if (!isCascadeTargetStatus(status)) {
        await updateTaskStatus(taskIdentifier, status);
        return true;
      }

      let openSubtasks: TaskStatusCascadeItem[];
      try {
        const result = await taskService.getSubtasks(taskIdentifier);
        openSubtasks = getOpenSubtasks(result.data);
      } catch (error) {
        console.error('[useTaskStatusChange] Failed to inspect subtasks:', error);
        toast.error(t('taskDetail.statusCascade.loadFailed'));
        throw error;
      }

      if (openSubtasks.length === 0) {
        await updateTaskStatus(taskIdentifier, status);
        return true;
      }

      return createTaskStatusCascadeModal({
        subtasks: openSubtasks,
        targetStatus: status,
        onApply: async (includeSubtasks) => {
          if (includeSubtasks) {
            await taskService.updateStatusCascade(taskIdentifier, status);
            const refreshResults = await Promise.allSettled([
              refreshTaskDetail(taskIdentifier),
              refreshTaskList(),
            ]);
            for (const refreshResult of refreshResults) {
              if (refreshResult.status === 'rejected') {
                console.error(
                  '[useTaskStatusChange] Failed to refresh after status cascade:',
                  refreshResult.reason,
                );
              }
            }
            return;
          }
          await updateTaskStatus(taskIdentifier, status);
        },
      });
    },
    [refreshTaskDetail, refreshTaskList, t, updateTaskStatus],
  );
};
