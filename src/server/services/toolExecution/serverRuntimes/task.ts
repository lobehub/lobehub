import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import {
  formatDependencyAdded,
  formatDependencyRemoved,
  formatTaskCreated,
  formatTaskDetail,
  formatTaskEdited,
  formatTaskList,
  priorityLabel,
} from '@lobechat/prompts';

import { TaskModel } from '@/database/models/task';
import { TaskService } from '@/server/services/task';

import { type ServerRuntimeRegistration } from './types';

const createTaskRuntime = ({
  taskId,
  taskModel,
  taskService,
}: {
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
    } else if (taskId) {
      parentTaskId = taskId;
      const current = await taskModel.findById(taskId);
      parentLabel = current?.identifier || taskId;
      parentConfig = current?.config as Record<string, any>;
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
      content: `Task ${task.identifier} "${task.name || ''}" has been deleted.`,
      success: true,
    };
  },

  editTask: async (args: {
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
  }) => {
    const task = await taskModel.resolve(args.identifier);
    if (!task) return { content: `Task not found: ${args.identifier}`, success: false };

    const updateData: Record<string, any> = {};
    const changes: string[] = [];

    if (args.name !== undefined) {
      updateData.name = args.name;
      changes.push(`name → "${args.name}"`);
    }
    if (args.instruction !== undefined) {
      updateData.instruction = args.instruction;
      changes.push(`instruction updated`);
    }
    if (args.priority !== undefined) {
      updateData.priority = args.priority;
      changes.push(`priority → ${priorityLabel(args.priority)}`);
    }
    if (args.review) {
      await taskModel.updateTaskConfig(task.id, { review: { enabled: true, ...args.review } });
      changes.push('review config updated');
    }

    if (Object.keys(updateData).length > 0) {
      await taskModel.update(task.id, updateData);
    }

    // Handle dependencies
    if (args.addDependency) {
      const dep = await taskModel.resolve(args.addDependency);
      if (!dep)
        return { content: `Dependency task not found: ${args.addDependency}`, success: false };
      await taskModel.addDependency(task.id, dep.id);
      changes.push(formatDependencyAdded(task.identifier, dep.identifier));
    }

    if (args.removeDependency) {
      const dep = await taskModel.resolve(args.removeDependency);
      if (!dep)
        return { content: `Dependency task not found: ${args.removeDependency}`, success: false };
      await taskModel.removeDependency(task.id, dep.id);
      changes.push(formatDependencyRemoved(task.identifier, dep.identifier));
    }

    return { content: formatTaskEdited(task.identifier, changes), success: true };
  },

  listTasks: async (args: { parentIdentifier?: string; status?: string }) => {
    let parentId: string | undefined;
    let parentLabel = 'current task';

    if (args.parentIdentifier) {
      const parent = await taskModel.resolve(args.parentIdentifier);
      if (!parent)
        return { content: `Parent task not found: ${args.parentIdentifier}`, success: false };
      parentId = parent.id;
      parentLabel = parent.identifier;
    } else {
      parentId = taskId;
    }

    if (!parentId) return { content: 'No task context available.', success: false };

    const subtasks = await taskModel.findSubtasks(parentId);
    let filtered = subtasks;
    if (args.status) {
      filtered = subtasks.filter((t) => t.status === args.status);
    }

    return {
      content: formatTaskList(filtered, parentLabel, args.status),
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

    return createTaskRuntime({ taskId: context.taskId, taskModel, taskService });
  },
  identifier: TaskIdentifier,
};
