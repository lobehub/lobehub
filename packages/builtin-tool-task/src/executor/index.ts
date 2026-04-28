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
import type { BuiltinToolContext, BuiltinToolResult, TaskStatus } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { getTaskStoreState } from '@/store/task';

import { normalizeListTasksParams } from '../listTasks';
import { TaskIdentifier } from '../manifest';
import { TaskApiName } from '../types';

const log = debug('lobe-task:executor');

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
      const parentIdentifier = params.parentIdentifier?.trim() || undefined;

      const task = await getTaskStoreState().createTask({
        assigneeAgentId: ctx?.agentId,
        createdByAgentId: ctx?.agentId,
        instruction: params.instruction,
        name: params.name,
        parentTaskId: parentIdentifier,
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
          parentLabel: parentIdentifier,
          priority: task.priority,
          status: task.status,
        }),
        state: { identifier: task.identifier, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] createTask - error:', error);
      const message = error instanceof Error ? error.message : String(error) || 'Unknown error';
      const content = message.startsWith('Failed to create task')
        ? message
        : `Failed to create task: ${message}`;
      return {
        content,
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
      statuses?: TaskStatus[];
    },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] listTasks - params:', params);

      const normalized = normalizeListTasksParams(params, {
        currentAgentId: ctx?.agentId,
      });

      const result = await getTaskStoreState().fetchTaskList(normalized.query);

      const tasks = result.data ?? [];

      return {
        content: formatTaskList(tasks, normalized.displayFilters),
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
    params: { error?: string; identifier?: string; status: TaskStatus },
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] updateTaskStatus - params:', params);

      const id = await getTaskStoreState().updateTaskStatus(params.identifier, params.status, {
        error: params.error,
      });

      return {
        content:
          params.status === 'failed' && params.error
            ? `Task ${id} status updated to failed. Error: ${params.error}`
            : `Task ${id} status updated to ${params.status}.`,
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

      const detail = await getTaskStoreState().fetchTaskDetail(params.identifier);

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
