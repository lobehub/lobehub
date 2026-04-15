import {
  formatDependencyAdded,
  formatDependencyRemoved,
  formatTaskCreated,
  formatTaskDeleted,
  formatTaskDetail,
  formatTaskEdited,
  formatTaskList,
  priorityLabel,
} from '@lobechat/prompts';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { mutate } from '@/libs/swr';
import { taskService } from '@/services/task';
import { getTaskStoreState } from '@/store/task';

import { UNFINISHED_TASK_STATUSES } from '../constants';
import { TaskIdentifier } from '../manifest';
import { TaskApiName } from '../types';

const FETCH_TASK_DETAIL_KEY = 'fetchTaskDetail';
const FETCH_TASK_LIST_KEY = 'fetchTaskList';
const FETCH_TASK_GROUP_LIST_KEY = 'fetchTaskGroupList';

const log = debug('lobe-task:executor');

/**
 * Resolve the current task identifier from store state.
 * Used as fallback when LLM omits the identifier parameter.
 */
const getCurrentTaskId = (): string | undefined => {
  try {
    return getTaskStoreState().activeTaskId;
  } catch {
    return undefined;
  }
};

const refreshTaskUI = async (taskId?: string, agentId?: string) => {
  const promises: Promise<any>[] = [];
  if (taskId) promises.push(mutate([FETCH_TASK_DETAIL_KEY, taskId]));
  promises.push(mutate([FETCH_TASK_LIST_KEY, agentId]));
  promises.push(mutate([FETCH_TASK_GROUP_LIST_KEY, agentId]));
  await Promise.all(promises);
};

class TaskExecutor extends BaseExecutor<typeof TaskApiName> {
  readonly identifier = TaskIdentifier;
  protected readonly apiEnum = TaskApiName;

  createTask = async (
    params: {
      instruction: string;
      name: string;
      parentIdentifier?: string;
      priority?: number;
      sortOrder?: number;
    },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] createTask - params:', params);

      const task = await getTaskStoreState().createTask({
        assigneeAgentId: ctx?.agentId,
        instruction: params.instruction,
        name: params.name,
        parentTaskId: params.parentIdentifier,
        priority: params.priority,
      });

      if (!task) {
        return {
          content: 'Failed to create task',
          error: { message: 'No data returned', type: 'CreateFailed' },
          success: false,
        };
      }

      return {
        content: formatTaskCreated({
          identifier: task.identifier,
          instruction: params.instruction,
          name: task.name,
          parentLabel: params.parentIdentifier,
          priority: task.priority,
          status: task.status,
        }),
        state: { identifier: task.identifier, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] createTask - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to create task';
      return {
        content: `Failed to create task: ${message}`,
        error: { message, type: 'CreateTaskFailed' },
        success: false,
      };
    }
  };

  deleteTask = async (
    params: { identifier: string },
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] deleteTask - params:', params);

      const deleted = await getTaskStoreState().deleteTask(params.identifier);
      const label = deleted?.identifier ?? params.identifier;

      return {
        content: formatTaskDeleted(label, deleted?.name),
        state: { identifier: label, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] deleteTask - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete task';
      return {
        content: `Failed to delete task: ${message}`,
        error: { message, type: 'DeleteTaskFailed' },
        success: false,
      };
    }
  };

  editTask = async (
    params: {
      addDependencies?: string[];
      description?: string;
      identifier: string;
      instruction?: string;
      name?: string;
      priority?: number;
      removeDependencies?: string[];
    },
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] editTask - params:', params);

      const { identifier, addDependencies, removeDependencies } = params;
      const store = getTaskStoreState();
      const changes: string[] = [];
      const ops: Promise<unknown>[] = [];

      const updateData: {
        description?: string;
        instruction?: string;
        name?: string;
        priority?: number;
      } = {};
      if (params.name !== undefined) {
        updateData.name = params.name;
        changes.push(`name → "${params.name}"`);
      }
      if (params.instruction !== undefined) {
        updateData.instruction = params.instruction;
        changes.push('instruction updated');
      }
      if (params.description !== undefined) {
        updateData.description = params.description;
        changes.push('description updated');
      }
      if (params.priority !== undefined) {
        updateData.priority = params.priority;
        changes.push(`priority → ${priorityLabel(params.priority)}`);
      }

      if (Object.keys(updateData).length > 0) {
        ops.push(store.updateTask(identifier, updateData));
      }

      if (addDependencies?.length) {
        addDependencies.forEach((dep) => {
          ops.push(store.addDependency(identifier, dep));
          changes.push(formatDependencyAdded(identifier, dep));
        });
      }
      if (removeDependencies?.length) {
        removeDependencies.forEach((dep) => {
          ops.push(store.removeDependency(identifier, dep));
          changes.push(formatDependencyRemoved(identifier, dep));
        });
      }

      await Promise.all(ops);

      return {
        content: formatTaskEdited(identifier, changes),
        state: { identifier, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] editTask - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to edit task';
      return {
        content: `Failed to edit task: ${message}`,
        error: { message, type: 'EditTaskFailed' },
        success: false,
      };
    }
  };

  listTasks = async (
    params: {
      assigneeAgentId?: string;
      limit?: number;
      offset?: number;
      parentIdentifier?: string;
      priorities?: number[];
      statuses?: string[];
    },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] listTasks - params:', params);

      let parentTaskId: string | null | undefined;
      if (params.parentIdentifier) {
        const parent = await taskService.find(params.parentIdentifier);
        if (!parent.data) {
          return {
            content: `Parent task not found: ${params.parentIdentifier}`,
            error: {
              message: `Parent task not found: ${params.parentIdentifier}`,
              type: 'TaskNotFound',
            },
            success: false,
          };
        }
        parentTaskId = parent.data.id;
      }

      const noFilters =
        !params.parentIdentifier &&
        !params.statuses?.length &&
        !params.priorities?.length &&
        !params.assigneeAgentId;

      const limit = Math.min(params.limit ?? 20, 100);

      const resolvedStatuses =
        params.statuses ?? (noFilters ? [...UNFINISHED_TASK_STATUSES] : undefined);
      const resolvedAgentId = params.assigneeAgentId ?? (noFilters ? ctx?.agentId : undefined);
      const resolvedParentTaskId = parentTaskId ?? (noFilters ? null : undefined);

      const result = await taskService.list({
        assigneeAgentId: resolvedAgentId,
        limit,
        offset: params.offset ?? 0,
        parentTaskId: resolvedParentTaskId,
        priorities: params.priorities,
        statuses: resolvedStatuses,
      });

      const tasks = result.data ?? [];

      return {
        content: formatTaskList(tasks, {
          assigneeAgentId: params.assigneeAgentId,
          parentIdentifier: params.parentIdentifier,
          priorities: params.priorities,
          statuses: params.statuses,
        }),
        state: { count: tasks.length, success: true, total: result.total },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] listTasks - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to list tasks';
      return {
        content: `Failed to list tasks: ${message}`,
        error: { message, type: 'ListTasksFailed' },
        success: false,
      };
    }
  };

  updateTaskStatus = async (
    params: { identifier?: string; status: string },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] updateTaskStatus - params:', params);

      const id = params.identifier || getCurrentTaskId();
      if (!id) {
        return {
          content: 'No task identifier provided and no current task context.',
          error: { message: 'No task identifier', type: 'NoTaskContext' },
          success: false,
        };
      }

      await taskService.updateStatus(
        id,
        params.status as 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running',
      );

      await refreshTaskUI(id, ctx?.agentId);

      return {
        content: `Task ${id} status updated to ${params.status}.`,
        state: { status: params.status, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] updateTaskStatus - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to update task status';
      return {
        content: `Failed to update task status: ${message}`,
        error: { message, type: 'UpdateStatusFailed' },
        success: false,
      };
    }
  };

  viewTask = async (
    params: { identifier?: string },
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] viewTask - params:', params);

      const id = params.identifier || getCurrentTaskId();
      if (!id) {
        return {
          content: 'No task identifier provided and no current task context.',
          error: { message: 'No task identifier', type: 'NoTaskContext' },
          success: false,
        };
      }

      const result = await taskService.getDetail(id);
      const detail = result.data;

      if (!detail) {
        return {
          content: `Task not found: ${id}`,
          error: { message: `Task not found: ${id}`, type: 'TaskNotFound' },
          success: false,
        };
      }

      return {
        content: formatTaskDetail(detail),
        state: { identifier: detail.identifier, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] viewTask - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to view task';
      return {
        content: `Failed to view task: ${message}`,
        error: { message, type: 'ViewTaskFailed' },
        success: false,
      };
    }
  };
}

export const taskExecutor = new TaskExecutor();
