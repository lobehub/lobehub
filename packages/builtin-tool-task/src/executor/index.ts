import {
  formatTaskCreated,
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
      review?: {
        autoRetry?: boolean;
        criteria?: Array<{ name: string; threshold: number }>;
        enabled?: boolean;
        maxIterations?: number;
      };
      sortOrder?: number;
    },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] createTask - params:', params);

      // Resolve parentTaskId: explicit > current task
      let parentTaskId: string | undefined;
      let parentLabel: string | undefined;

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
        parentLabel = parent.data.identifier;
      } else {
        const currentId = getCurrentTaskId();
        if (currentId) {
          parentTaskId = currentId;
          parentLabel = 'current task';
        }
      }

      const result = await taskService.create({
        assigneeAgentId: ctx?.agentId,
        instruction: params.instruction,
        name: params.name,
        parentTaskId,
        priority: params.priority,
      });

      const task = result.data;
      if (!task) {
        return {
          content: 'Failed to create task',
          error: { message: 'No data returned', type: 'CreateFailed' },
          success: false,
        };
      }

      // Post-create: write review config if provided
      if (params.review) {
        await taskService.updateConfig(task.id, { review: { enabled: true, ...params.review } });
      }

      await refreshTaskUI(undefined, ctx?.agentId);

      return {
        content: formatTaskCreated({
          identifier: task.identifier,
          instruction: params.instruction,
          name: task.name,
          parentLabel,
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
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] deleteTask - params:', params);

      const found = await taskService.find(params.identifier);
      if (!found.data) {
        return {
          content: `Task not found: ${params.identifier}`,
          error: { message: `Task not found: ${params.identifier}`, type: 'TaskNotFound' },
          success: false,
        };
      }

      await taskService.delete(found.data.id);
      await refreshTaskUI(undefined, ctx?.agentId);

      return {
        content: `Task ${found.data.identifier} "${found.data.name || ''}" has been deleted.`,
        state: { success: true },
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
      addDependency?: string;
      identifier: string;
      instruction?: string;
      name?: string;
      priority?: number;
      removeDependency?: string;
      review?: {
        autoRetry?: boolean;
        criteria?: Array<{ name: string; threshold: number }>;
        enabled?: boolean;
        maxIterations?: number;
      };
    },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] editTask - params:', params);

      const found = await taskService.find(params.identifier);
      if (!found.data) {
        return {
          content: `Task not found: ${params.identifier}`,
          error: { message: `Task not found: ${params.identifier}`, type: 'TaskNotFound' },
          success: false,
        };
      }

      const task = found.data;
      const changes: string[] = [];
      const updateData: Record<string, unknown> = {};

      if (params.name !== undefined) {
        updateData.name = params.name;
        changes.push(`name → "${params.name}"`);
      }
      if (params.instruction !== undefined) {
        updateData.instruction = params.instruction;
        changes.push('instruction updated');
      }
      if (params.priority !== undefined) {
        updateData.priority = params.priority;
        changes.push(`priority → ${priorityLabel(params.priority)}`);
      }

      if (Object.keys(updateData).length > 0) {
        await taskService.update(task.id, updateData);
      }

      if (params.review) {
        await taskService.updateConfig(task.id, { review: { enabled: true, ...params.review } });
        changes.push('review config updated');
      }

      // TRPC addDependency/removeDependency resolve both params
      if (params.addDependency) {
        await taskService.addDependency(task.identifier, params.addDependency);
        changes.push(`dependency added: blocks on ${params.addDependency}`);
      }
      if (params.removeDependency) {
        await taskService.removeDependency(task.identifier, params.removeDependency);
        changes.push(`dependency removed: ${params.removeDependency}`);
      }

      await refreshTaskUI(task.id, ctx?.agentId);

      return {
        content: formatTaskEdited(task.identifier, changes),
        state: { identifier: task.identifier, success: true },
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
    params: { parentIdentifier?: string; status?: string },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] listTasks - params:', params);

      // TRPC list does NOT resolve parentTaskId, must resolve manually
      let parentId: string | undefined;
      let parentLabel = 'current task';

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
        parentId = parent.data.id;
        parentLabel = parent.data.identifier;
      } else {
        parentId = getCurrentTaskId();
      }

      if (!parentId) {
        return {
          content: 'No task context available. Provide a parentIdentifier.',
          error: { message: 'No task context', type: 'NoTaskContext' },
          success: false,
        };
      }

      const result = await taskService.list({
        parentTaskId: parentId,
        status: params.status,
      });

      const tasks = result.data || [];

      return {
        content: formatTaskList(tasks as any[], parentLabel, params.status),
        state: { count: tasks.length, success: true },
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
