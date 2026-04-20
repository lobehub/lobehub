import { normalizeListTasksParams, TaskIdentifier } from '@lobechat/builtin-tool-task';
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
import type { TaskStatus } from '@lobechat/types';

import { TaskModel } from '@/database/models/task';
import { taskRouter } from '@/server/routers/lambda/task';
import { TaskService } from '@/server/services/task';

import { type ServerRuntimeRegistration } from './types';

export const createTaskRuntime = ({
  agentId,
  taskId,
  taskCaller,
  taskModel,
  taskService,
}: {
  agentId?: string;
  taskId?: string;
  taskCaller: ReturnType<typeof taskRouter.createCaller>;
  taskModel: TaskModel;
  taskService: TaskService;
}) => ({
  createTask: async (args: {
    instruction: string;
    name: string;
    parentIdentifier?: string;
    priority?: number;
    sortOrder?: number;
  }) => {
    let parentTaskId: string | undefined;
    let parentLabel: string | undefined;

    if (args.parentIdentifier) {
      const parent = await taskModel.resolve(args.parentIdentifier);
      if (!parent)
        return { content: `Parent task not found: ${args.parentIdentifier}`, success: false };
      parentTaskId = parent.id;
      parentLabel = parent.identifier;
    }

    const task = await taskModel.create({
      assigneeAgentId: agentId,
      createdByAgentId: agentId,
      instruction: args.instruction,
      name: args.name,
      parentTaskId,
      priority: args.priority,
      sortOrder: args.sortOrder,
    });

    return {
      content: formatTaskCreated({
        identifier: task.identifier,
        instruction: args.instruction,
        name: task.name,
        parentLabel,
        priority: task.priority,
        status: task.status,
      }),
      success: true,
    };
  },

  deleteTask: async (args: { identifier: string }) => {
    const task = await taskModel.resolve(args.identifier);
    if (!task) return { content: `Task not found: ${args.identifier}`, success: false };

    await taskModel.delete(task.id);

    return {
      content: formatTaskDeleted(task.identifier, task.name),
      success: true,
    };
  },

  editTask: async (args: {
    addDependencies?: string[];
    description?: string;
    identifier: string;
    instruction?: string;
    name?: string;
    priority?: number;
    removeDependencies?: string[];
  }) => {
    const task = await taskModel.resolve(args.identifier);
    if (!task) return { content: `Task not found: ${args.identifier}`, success: false };

    const updateData: Record<string, any> = {};
    const changes: string[] = [];
    const ops: Promise<unknown>[] = [];

    if (args.name !== undefined) {
      updateData.name = args.name;
      changes.push(`name → "${args.name}"`);
    }
    if (args.instruction !== undefined) {
      updateData.instruction = args.instruction;
      changes.push(`instruction updated`);
    }
    if (args.description !== undefined) {
      updateData.description = args.description;
      changes.push('description updated');
    }
    if (args.priority !== undefined) {
      updateData.priority = args.priority;
      changes.push(`priority → ${priorityLabel(args.priority)}`);
    }

    if (Object.keys(updateData).length > 0) {
      ops.push(taskModel.update(task.id, updateData));
    }

    const applyDeps = async (
      ids: string[],
      apply: (depId: string) => Promise<unknown>,
      onChange: (depIdentifier: string) => void,
    ): Promise<string | undefined> => {
      const resolved = await Promise.all(
        ids.map((id) => taskModel.resolve(id).then((r) => ({ id, resolved: r }))),
      );
      const missing = resolved.find((r) => !r.resolved);
      if (missing) return `Dependency task not found: ${missing.id}`;

      await Promise.all(resolved.map(({ resolved: dep }) => apply(dep!.id)));
      resolved.forEach(({ resolved: dep }) => onChange(dep!.identifier));
    };

    const depResults: Promise<string | undefined>[] = [];
    if (args.addDependencies?.length) {
      depResults.push(
        applyDeps(
          args.addDependencies,
          (depId) => taskModel.addDependency(task.id, depId),
          (depIdentifier) => changes.push(formatDependencyAdded(task.identifier, depIdentifier)),
        ),
      );
    }
    if (args.removeDependencies?.length) {
      depResults.push(
        applyDeps(
          args.removeDependencies,
          (depId) => taskModel.removeDependency(task.id, depId),
          (depIdentifier) => changes.push(formatDependencyRemoved(task.identifier, depIdentifier)),
        ),
      );
    }

    const [, depErrors] = await Promise.all([Promise.all(ops), Promise.all(depResults)]);
    const firstDepError = depErrors.find((e) => e);
    if (firstDepError) return { content: firstDepError, success: false };

    return { content: formatTaskEdited(task.identifier, changes), success: true };
  },

  listTasks: async (args: {
    assigneeAgentId?: string;
    limit?: number;
    offset?: number;
    parentIdentifier?: string;
    priorities?: number[];
    statuses?: TaskStatus[];
  }) => {
    const normalized = normalizeListTasksParams(args, {
      currentAgentId: agentId,
    });

    try {
      const result = await taskCaller.list(normalized.query);

      return {
        content: formatTaskList(result.data, normalized.displayFilters),
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list tasks';

      return {
        content: `Failed to list tasks: ${message}`,
        success: false,
      };
    }
  },

  updateTaskStatus: async (args: { error?: string; identifier?: string; status: TaskStatus }) => {
    const id = args.identifier || taskId;
    if (!id) {
      return {
        content: 'No task identifier provided and no current task context.',
        success: false,
      };
    }

    try {
      const result = await taskCaller.updateStatus({
        error: args.error,
        id,
        status: args.status,
      });

      return {
        content:
          args.status === 'failed' && args.error
            ? `Task ${result.data.identifier} status updated to failed. Error: ${args.error}`
            : `Task ${result.data.identifier} status updated to ${args.status}.`,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update task status';

      return {
        content: `Failed to update task status: ${message}`,
        success: false,
      };
    }
  },

  viewTask: async (args: { identifier?: string }) => {
    const id = args.identifier || taskId;
    if (!id) {
      return {
        content: 'No task identifier provided and no current task context.',
        success: false,
      };
    }

    const detail = await taskService.getTaskDetail(id);
    if (!detail) return { content: `Task not found: ${id}`, success: false };

    return {
      content: formatTaskDetail(detail),
      success: true,
    };
  },
});

export const taskRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Task tool execution');
    }

    const taskModel = new TaskModel(context.serverDB, context.userId);
    const taskService = new TaskService(context.serverDB, context.userId);
    const taskCaller = taskRouter.createCaller({ userId: context.userId });

    return createTaskRuntime({
      agentId: context.agentId,
      taskCaller,
      taskId: context.taskId,
      taskModel,
      taskService,
    });
  },
  identifier: TaskIdentifier,
};
