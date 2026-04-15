import { TaskIdentifier, UNFINISHED_TASK_STATUSES } from '@lobechat/builtin-tool-task';
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

import { TaskModel } from '@/database/models/task';
import { TaskService } from '@/server/services/task';

import { type ServerRuntimeRegistration } from './types';

const createTaskRuntime = ({
  agentId,
  taskId,
  taskModel,
  taskService,
}: {
  agentId?: string;
  taskId?: string;
  taskModel: TaskModel;
  taskService: TaskService;
}) => ({
  createTask: async (args: {
    instruction: string;
    name: string;
    parentIdentifier?: string;
    priority?: number;
    sortOrder?: number;
    review?: {
      autoRetry?: boolean;
      criteria?: Array<{ name: string; threshold: number }>;
      enabled?: boolean;
      maxIterations?: number;
    };
  }) => {
    let parentTaskId: string | undefined;
    let parentLabel: string | undefined;
    let parentConfig: Record<string, any> | undefined;

    if (args.parentIdentifier) {
      const parent = await taskModel.resolve(args.parentIdentifier);
      if (!parent)
        return { content: `Parent task not found: ${args.parentIdentifier}`, success: false };
      parentTaskId = parent.id;
      parentLabel = parent.identifier;
      parentConfig = parent.config as Record<string, any>;
    }

    // Build config: explicit review > inherited from parent
    let config: Record<string, any> | undefined;
    if (args.review) {
      config = { review: { enabled: true, ...args.review } };
    } else if (parentConfig?.review) {
      config = { review: parentConfig.review };
    }

    const task = await taskModel.create({
      ...(config && { config }),
      assigneeAgentId: agentId,
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
    review?: {
      autoRetry?: boolean;
      criteria?: Array<{ name: string; threshold: number }>;
      enabled?: boolean;
      maxIterations?: number;
    };
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

    // TODO [LOBE-7199]: align criteria/rubrics schema and switch to typed updateReviewConfig
    if (args.review) {
      ops.push(taskModel.updateTaskConfig(task.id, { review: { enabled: true, ...args.review } }));
      changes.push('review config updated');
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
    statuses?: string[];
  }) => {
    let parentTaskId: string | null | undefined;
    if (args.parentIdentifier) {
      const parent = await taskModel.resolve(args.parentIdentifier);
      if (!parent)
        return { content: `Parent task not found: ${args.parentIdentifier}`, success: false };
      parentTaskId = parent.id;
    }

    const noFilters =
      !args.parentIdentifier &&
      !args.statuses?.length &&
      !args.priorities?.length &&
      !args.assigneeAgentId;

    const limit = Math.min(args.limit ?? 20, 100);

    const resolvedStatuses =
      args.statuses ?? (noFilters ? [...UNFINISHED_TASK_STATUSES] : undefined);
    const resolvedAgentId = args.assigneeAgentId ?? (noFilters ? agentId : undefined);
    const resolvedParentTaskId = parentTaskId ?? (noFilters ? null : undefined);

    const result = await taskModel.list({
      assigneeAgentId: resolvedAgentId,
      limit,
      offset: args.offset ?? 0,
      parentTaskId: resolvedParentTaskId,
      priorities: args.priorities,
      statuses: resolvedStatuses,
    });

    return {
      content: formatTaskList(result.tasks, {
        assigneeAgentId: args.assigneeAgentId,
        parentIdentifier: args.parentIdentifier,
        priorities: args.priorities,
        statuses: args.statuses,
      }),
      success: true,
    };
  },

  updateTaskStatus: async (args: { identifier?: string; status: string }) => {
    const id = args.identifier || taskId;
    if (!id) {
      return {
        content: 'No task identifier provided and no current task context.',
        success: false,
      };
    }

    const task = await taskModel.resolve(id);
    if (!task) return { content: `Task not found: ${id}`, success: false };

    const updated = await taskModel.updateStatus(task.id, args.status);
    if (!updated) return { content: `Failed to update task ${task.identifier}`, success: false };

    return {
      content: `Task ${task.identifier} status updated to ${args.status}.`,
      success: true,
    };
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

    return createTaskRuntime({
      agentId: context.agentId,
      taskId: context.taskId,
      taskModel,
      taskService,
    });
  },
  identifier: TaskIdentifier,
};
