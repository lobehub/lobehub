'use client';

import type { TaskStatus } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';

import type { TaskStatusCascadeItem } from './TaskStatusCascadeModal';
import { createTaskStatusCascadeModal } from './TaskStatusCascadeModal';

const CASCADE_TARGET_STATUSES = new Set<TaskStatus>(['canceled', 'completed']);
const TERMINAL_SUBTASK_STATUSES = new Set<TaskStatus>(['canceled', 'completed']);

export const getOpenSubtasks = (subtasks: TaskStatusCascadeItem[]): TaskStatusCascadeItem[] =>
  subtasks.filter((task) => !TERMINAL_SUBTASK_STATUSES.has(task.status as TaskStatus));

export const useTaskStatusChange = () => {
  const { t } = useTranslation('chat');
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);

  return useCallback(
    async (taskIdentifier: string, status: TaskStatus): Promise<boolean> => {
      if (!CASCADE_TARGET_STATUSES.has(status)) {
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
            for (const subtask of openSubtasks) {
              await updateTaskStatus(subtask.identifier, status);
            }
          }
          await updateTaskStatus(taskIdentifier, status);
        },
      });
    },
    [t, updateTaskStatus],
  );
};
