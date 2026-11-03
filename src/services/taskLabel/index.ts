import type { TaskLabelRef, TaskLabelWithUsage } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface TaskLabelInput {
  color?: string | null;
  description?: string | null;
  isGroup?: boolean;
  name: string;
  parentId?: string | null;
}

export interface TaskLabelPatch {
  color?: string | null;
  description?: string | null;
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
}

class TaskLabelService {
  list = (): Promise<TaskLabelWithUsage[]> => lambdaClient.taskLabel.list.query();

  create = (params: TaskLabelInput) => lambdaClient.taskLabel.create.mutate(params);

  update = (id: string, value: TaskLabelPatch) =>
    lambdaClient.taskLabel.update.mutate({ id, value });

  delete = (id: string) => lambdaClient.taskLabel.delete.mutate({ id });

  /** Attach labels; a grouped label replaces the sibling the task already carried. */
  addToTask = (taskId: string, labelIds: string[]): Promise<TaskLabelRef[]> =>
    lambdaClient.taskLabel.addToTask.mutate({ labelIds, taskId });

  removeFromTask = (taskId: string, labelIds: string[]): Promise<TaskLabelRef[]> =>
    lambdaClient.taskLabel.removeFromTask.mutate({ labelIds, taskId });

  /** Add and remove labels in one transaction, so a swap never commits half-way. */
  changeForTask = (
    taskId: string,
    delta: { add?: string[]; remove?: string[] },
  ): Promise<TaskLabelRef[]> => lambdaClient.taskLabel.changeForTask.mutate({ ...delta, taskId });

  /** Replace the full label set; prefer add/remove for single toggles. */
  setForTask = (taskId: string, labelIds: string[]): Promise<TaskLabelRef[]> =>
    lambdaClient.taskLabel.setForTask.mutate({ labelIds, taskId });
}

export const taskLabelService = new TaskLabelService();
