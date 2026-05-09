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

import { taskService } from '@/services/task';
import { getTaskStoreState } from '@/store/task';

import { normalizeListTasksParams } from '../listTasks';
import { TaskIdentifier } from '../manifest';
import type {
  AddTaskCommentParams,
  CreateTaskParams,
  CreateTasksItemResult,
  DeleteTaskCommentParams,
  RunTasksItemResult,
  UpdateTaskCommentParams,
} from '../types';
import { TaskApiName } from '../types';

const log = debug('lobe-task:executor');

class TaskExecutor extends BaseExecutor<typeof TaskApiName> {
  readonly identifier = TaskIdentifier;
  protected readonly apiEnum = TaskApiName;

  addTaskComment = async (
    params: AddTaskCommentParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const identifier = params.identifier?.trim() || ctx?.taskId || undefined;
    if (!identifier) {
      return {
        content: 'No task identifier provided.',
        error: { message: 'identifier is required', type: 'MissingIdentifier' },
        success: false,
      };
    }

    try {
      log('[TaskExecutor] addTaskComment - identifier:', identifier);
      const result = await getTaskStoreState().addComment(identifier, params.content, {
        authorAgentId: ctx?.agentId,
      });
      const commentId = (result as { data?: { id?: string } } | undefined)?.data?.id;

      return {
        content: `Comment added to task ${identifier}.`,
        state: { commentId, identifier, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] addTaskComment - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to add task comment';
      return {
        content: `Failed to add task comment: ${message}`,
        error: { message, type: 'AddTaskCommentFailed' },
        success: false,
      };
    }
  };

  createTask = async (
    params: {
      instruction: string;
      assigneeAgentId?: string;
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
        assigneeAgentId:
          params.assigneeAgentId ?? (ctx?.scope === 'task' ? undefined : ctx?.agentId),
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

  createTasks = async (
    params: { tasks: CreateTaskParams[] },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    log('[TaskExecutor] createTasks - count:', params.tasks?.length);
    const items = Array.isArray(params.tasks) ? params.tasks : [];

    if (items.length === 0) {
      return {
        content: 'No tasks provided.',
        error: { message: 'tasks array is empty', type: 'EmptyBatch' },
        success: false,
      };
    }

    const results: CreateTasksItemResult[] = [];
    const lines: string[] = [];

    for (const [index, item] of items.entries()) {
      const result = await this.createTask(item, ctx);
      const success = result.success === true;
      const identifier =
        success && result.state && typeof result.state.identifier === 'string'
          ? (result.state.identifier as string)
          : undefined;
      const error = success
        ? undefined
        : result.error?.message ||
          (typeof result.content === 'string' ? result.content : 'Unknown error');

      results.push({ error, identifier, name: item.name, success });

      if (success) {
        lines.push(`${index + 1}. ${identifier ?? '(unknown id)'} "${item.name}" — created`);
      } else {
        lines.push(`${index + 1}. "${item.name}" — failed: ${error}`);
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;
    const header =
      failed === 0
        ? `Created ${succeeded} task${succeeded === 1 ? '' : 's'}:`
        : `Created ${succeeded}/${results.length} tasks (${failed} failed):`;

    return {
      content: [header, ...lines].join('\n'),
      state: { failed, results, succeeded },
      success: failed === 0,
    };
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

  deleteTaskComment = async (
    params: DeleteTaskCommentParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] deleteTaskComment - commentId:', params.commentId);
      await getTaskStoreState().deleteComment(params.commentId, ctx?.taskId ?? undefined);

      return {
        content: `Comment ${params.commentId} deleted.`,
        state: { commentId: params.commentId, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] deleteTaskComment - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete task comment';
      return {
        content: `Failed to delete task comment: ${message}`,
        error: { message, type: 'DeleteTaskCommentFailed' },
        success: false,
      };
    }
  };

  editTask = async (
    params: {
      addDependencies?: string[];
      assigneeAgentId?: string | null;
      description?: string;
      identifier: string;
      instruction?: string;
      name?: string;
      parentIdentifier?: string | null;
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
        assigneeAgentId?: string | null;
        instruction?: string;
        name?: string;
        parentTaskId?: string | null;
        priority?: number;
      } = {};
      if (params.name !== undefined) {
        updateData.name = params.name;
        changes.push(`name → "${params.name}"`);
      }
      if (params.assigneeAgentId !== undefined) {
        updateData.assigneeAgentId = params.assigneeAgentId;
        changes.push(
          params.assigneeAgentId
            ? `assignee agent → ${params.assigneeAgentId}`
            : 'assignee cleared',
        );
      }
      if (params.instruction !== undefined) {
        updateData.instruction = params.instruction;
        changes.push('instruction updated');
      }
      if (params.description !== undefined) {
        updateData.description = params.description;
        changes.push('description updated');
      }
      if (params.parentIdentifier !== undefined) {
        const parentIdentifier = params.parentIdentifier?.trim() || null;
        updateData.parentTaskId = parentIdentifier;
        changes.push(parentIdentifier ? `parent → ${parentIdentifier}` : 'parent cleared');
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
        defaultScope: ctx?.scope === 'task' ? 'allAgents' : 'currentAgent',
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

  runTask = async (
    params: { continueTopicId?: string; identifier?: string; prompt?: string },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const identifier = params.identifier?.trim() || ctx?.taskId || undefined;
    if (!identifier) {
      return {
        content: 'No task identifier provided.',
        error: { message: 'identifier is required', type: 'MissingIdentifier' },
        success: false,
      };
    }

    try {
      log('[TaskExecutor] runTask - identifier:', identifier);
      const result = await taskService.run(identifier, {
        continueTopicId: params.continueTopicId,
        prompt: params.prompt,
      });

      const topicId = (result as { topicId?: string } | undefined)?.topicId;
      const operationId = (result as { operationId?: string } | undefined)?.operationId;

      const store = getTaskStoreState();
      await Promise.all([store.internal_refreshTaskDetail(identifier), store.refreshTaskList()]);

      const lines = [`Task ${identifier} started.`];
      if (topicId) lines.push(`  Topic: ${topicId}`);
      if (operationId) lines.push(`  Operation: ${operationId}`);

      return {
        content: lines.join('\n'),
        state: { identifier, operationId, success: true, topicId },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] runTask - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to run task';
      return {
        content: `Failed to run task ${identifier}: ${message}`,
        error: { message, type: 'RunTaskFailed' },
        success: false,
      };
    }
  };

  runTasks = async (
    params: { identifiers: string[] },
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const identifiers = Array.isArray(params.identifiers)
      ? params.identifiers.map((id) => id?.trim()).filter((id): id is string => !!id)
      : [];

    if (identifiers.length === 0) {
      return {
        content: 'No task identifiers provided.',
        error: { message: 'identifiers array is empty', type: 'EmptyBatch' },
        success: false,
      };
    }

    log('[TaskExecutor] runTasks - count:', identifiers.length);

    const results: RunTasksItemResult[] = [];
    const lines: string[] = [];

    for (const [index, identifier] of identifiers.entries()) {
      try {
        const result = await taskService.run(identifier);
        const topicId = (result as { topicId?: string } | undefined)?.topicId;
        const operationId = (result as { operationId?: string } | undefined)?.operationId;
        results.push({ identifier, operationId, success: true, topicId });
        lines.push(`${index + 1}. ${identifier} — started${topicId ? ` (topic ${topicId})` : ''}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({ error: message, identifier, success: false });
        lines.push(`${index + 1}. ${identifier} — failed: ${message}`);
      }
    }

    try {
      await getTaskStoreState().refreshTaskList();
    } catch {
      // ignore refresh errors — they don't change the executor result
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;
    const header =
      failed === 0
        ? `Started ${succeeded} task${succeeded === 1 ? '' : 's'}:`
        : `Started ${succeeded}/${results.length} tasks (${failed} failed):`;

    return {
      content: [header, ...lines].join('\n'),
      state: { failed, results, succeeded },
      success: failed === 0,
    };
  };

  updateTaskComment = async (
    params: UpdateTaskCommentParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] updateTaskComment - commentId:', params.commentId);
      await getTaskStoreState().updateComment(
        params.commentId,
        params.content,
        ctx?.taskId ?? undefined,
      );

      return {
        content: `Comment ${params.commentId} updated.`,
        state: { commentId: params.commentId, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] updateTaskComment - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to update task comment';
      return {
        content: `Failed to update task comment: ${message}`,
        error: { message, type: 'UpdateTaskCommentFailed' },
        success: false,
      };
    }
  };

  updateTaskStatus = async (
    params: { error?: string; identifier?: string; status: TaskStatus },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] updateTaskStatus - params:', params);

      const identifier = params.identifier ?? ctx?.taskId ?? undefined;
      const id = await getTaskStoreState().updateTaskStatus(identifier, params.status, {
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
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] viewTask - params:', params);

      const detail = await getTaskStoreState().fetchTaskDetail(
        params.identifier ?? ctx?.taskId ?? undefined,
      );

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
