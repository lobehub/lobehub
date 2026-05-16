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
import type { TaskAutomationMode, TaskStatus } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { TaskModel } from '@/database/models/task';
import { taskRouter } from '@/server/routers/lambda/task';
import { TaskService } from '@/server/services/task';

import { type ServerRuntimeRegistration } from './types';

export const createTaskRuntime = ({
  agentModel,
  agentId,
  scope,
  taskId,
  taskCaller,
  taskModel,
  taskService,
}: {
  agentModel: AgentModel;
  agentId?: string;
  scope?: string | null;
  taskId?: string;
  taskCaller: ReturnType<typeof taskRouter.createCaller>;
  taskModel: TaskModel;
  taskService: TaskService;
}) => {
  const resolveAssigneeAgent = async (assigneeAgentId?: string | null) => {
    if (!assigneeAgentId) return { success: true } as const;

    const exists = await agentModel.existsById(assigneeAgentId);
    if (exists) return { success: true } as const;

    return {
      content: `Assignee agent not found: ${assigneeAgentId}`,
      success: false,
    } as const;
  };

  type CreateTaskArgs = {
    instruction: string;
    assigneeAgentId?: string;
    name: string;
    parentIdentifier?: string;
    priority?: number;
    sortOrder?: number;
  };

  const createTaskImpl = async (
    args: CreateTaskArgs,
  ): Promise<{ content: string; identifier?: string; success: boolean }> => {
    let parentLabel: string | undefined;

    // Pre-resolve parent identifier so we can surface a tool-friendly error
    // and label, and pass the resolved id straight through to the service.
    let parentTaskId: string | undefined;
    if (args.parentIdentifier) {
      const parent = await taskModel.resolve(args.parentIdentifier);
      if (!parent)
        return { content: `Parent task not found: ${args.parentIdentifier}`, success: false };
      parentTaskId = parent.id;
      parentLabel = parent.identifier;
    }

    const assigneeResult = await resolveAssigneeAgent(args.assigneeAgentId);
    if (!assigneeResult.success) return { content: assigneeResult.content, success: false };

    const task = await taskService.createTask({
      assigneeAgentId: args.assigneeAgentId ?? (scope === 'task' ? undefined : agentId),
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
      identifier: task.identifier,
      success: true,
    };
  };

  return {
    addTaskComment: async (args: { content: string; identifier?: string }) => {
      const id = args.identifier?.trim() || taskId;
      if (!id) {
        return {
          content: 'No task identifier provided and no current task context.',
          success: false,
        };
      }

      try {
        const result = await taskCaller.addComment({
          authorAgentId: agentId,
          content: args.content,
          id,
        });

        return {
          content: `Comment added to task ${id}.`,
          success: true,
          state: { commentId: result.data.id, identifier: id, success: true },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to add task comment';
        return { content: `Failed to add task comment: ${message}`, success: false };
      }
    },

    createTask: async (args: CreateTaskArgs) => {
      const result = await createTaskImpl(args);
      const { identifier: _identifier, ...rest } = result;
      return rest;
    },

    createTasks: async (args: { tasks: CreateTaskArgs[] }) => {
      const items = Array.isArray(args.tasks) ? args.tasks : [];
      if (items.length === 0) {
        return { content: 'No tasks provided.', success: false };
      }

      const lines: string[] = [];
      let succeeded = 0;
      let failed = 0;

      for (const [index, item] of items.entries()) {
        try {
          const result = await createTaskImpl(item);
          if (result.success) {
            succeeded += 1;
            lines.push(
              `${index + 1}. ${result.identifier ?? '(unknown id)'} "${item.name}" — created`,
            );
          } else {
            failed += 1;
            lines.push(`${index + 1}. "${item.name}" — failed: ${result.content}`);
          }
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : 'Unknown error';
          lines.push(`${index + 1}. "${item.name}" — failed: ${message}`);
        }
      }

      const header =
        failed === 0
          ? `Created ${succeeded} task${succeeded === 1 ? '' : 's'}:`
          : `Created ${succeeded}/${items.length} tasks (${failed} failed):`;

      return {
        content: [header, ...lines].join('\n'),
        success: failed === 0,
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

    deleteTaskComment: async (args: { commentId: string }) => {
      try {
        await taskCaller.deleteComment({ commentId: args.commentId });
        return {
          content: `Comment ${args.commentId} deleted.`,
          success: true,
          state: { commentId: args.commentId, success: true },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete task comment';
        return { content: `Failed to delete task comment: ${message}`, success: false };
      }
    },

    editTask: async (args: {
      addDependencies?: string[];
      assigneeAgentId?: string | null;
      description?: string;
      identifier: string;
      instruction?: string;
      name?: string;
      parentIdentifier?: string | null;
      priority?: number;
      removeDependencies?: string[];
    }) => {
      const task = await taskModel.resolve(args.identifier);
      if (!task) return { content: `Task not found: ${args.identifier}`, success: false };

      const updateData: {
        assigneeAgentId?: string | null;
        description?: string;
        instruction?: string;
        name?: string;
        parentTaskId?: string | null;
        priority?: number;
      } = {};
      const changes: string[] = [];
      const ops: Promise<unknown>[] = [];

      if (args.name !== undefined) {
        updateData.name = args.name;
        changes.push(`name → "${args.name}"`);
      }
      if (args.assigneeAgentId !== undefined) {
        const assigneeResult = await resolveAssigneeAgent(args.assigneeAgentId);
        if (!assigneeResult.success) return assigneeResult;

        updateData.assigneeAgentId = args.assigneeAgentId;
        changes.push(
          args.assigneeAgentId ? `assignee agent → ${args.assigneeAgentId}` : 'assignee cleared',
        );
      }
      if (args.instruction !== undefined) {
        updateData.instruction = args.instruction;
        changes.push(`instruction updated`);
      }
      if (args.description !== undefined) {
        updateData.description = args.description;
        changes.push('description updated');
      }
      if (args.parentIdentifier !== undefined) {
        const parentIdentifier = args.parentIdentifier?.trim() || null;
        updateData.parentTaskId = parentIdentifier;
        changes.push(parentIdentifier ? `parent → ${parentIdentifier}` : 'parent cleared');
      }
      if (args.priority !== undefined) {
        updateData.priority = args.priority;
        changes.push(`priority → ${priorityLabel(args.priority)}`);
      }

      if (Object.keys(updateData).length > 0) {
        ops.push(taskCaller.update({ id: task.id, ...updateData }));
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
            (depIdentifier) =>
              changes.push(formatDependencyRemoved(task.identifier, depIdentifier)),
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
        defaultScope: scope === 'task' ? 'allAgents' : 'currentAgent',
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

    setTaskSchedule: async (args: {
      automationMode?: TaskAutomationMode | null;
      heartbeatInterval?: number;
      identifier: string;
      maxExecutions?: number | null;
      schedulePattern?: string | null;
      scheduleTimezone?: string | null;
    }) => {
      const task = await taskModel.resolve(args.identifier);
      if (!task) return { content: `Task not found: ${args.identifier}`, success: false };

      const changes: string[] = [];
      const ops: Promise<unknown>[] = [];

      // Mirrors client executor: schedule columns go through taskCaller.update;
      // maxExecutions lives in `tasks.config.schedule.maxExecutions` (JSONB) and
      // routes through updateConfig so server-side merge preserves siblings.
      const scheduleUpdate: {
        automationMode?: TaskAutomationMode | null;
        heartbeatInterval?: number;
        schedulePattern?: string | null;
        scheduleTimezone?: string | null;
      } = {};
      if (args.automationMode !== undefined) {
        scheduleUpdate.automationMode = args.automationMode;
        changes.push(
          args.automationMode ? `automation mode → ${args.automationMode}` : 'automation disabled',
        );
      }
      if (args.heartbeatInterval !== undefined) {
        scheduleUpdate.heartbeatInterval = args.heartbeatInterval;
        changes.push(
          args.heartbeatInterval > 0
            ? `heartbeat interval → ${args.heartbeatInterval}s`
            : 'heartbeat interval cleared',
        );
      }
      if (args.schedulePattern !== undefined) {
        scheduleUpdate.schedulePattern = args.schedulePattern;
        changes.push(
          args.schedulePattern
            ? `schedule pattern → "${args.schedulePattern}"`
            : 'schedule pattern cleared',
        );
      }
      if (args.scheduleTimezone !== undefined) {
        scheduleUpdate.scheduleTimezone = args.scheduleTimezone;
        changes.push(
          args.scheduleTimezone
            ? `schedule timezone → ${args.scheduleTimezone}`
            : 'schedule timezone cleared',
        );
      }
      if (Object.keys(scheduleUpdate).length > 0) {
        ops.push(taskCaller.update({ id: task.id, ...scheduleUpdate }));
      }

      if (args.maxExecutions !== undefined) {
        ops.push(
          taskCaller.updateConfig({
            config: { schedule: { maxExecutions: args.maxExecutions } },
            id: task.id,
          }),
        );
        changes.push(
          args.maxExecutions === null
            ? 'max executions cleared (unlimited)'
            : `max executions → ${args.maxExecutions}`,
        );
      }

      if (ops.length === 0) {
        return { content: 'No schedule fields provided; nothing to update.', success: false };
      }

      await Promise.all(ops);

      return { content: formatTaskEdited(task.identifier, changes), success: true };
    },

    runTask: async (args: { continueTopicId?: string; identifier?: string; prompt?: string }) => {
      const id = args.identifier?.trim() || taskId;
      if (!id) {
        return {
          content: 'No task identifier provided and no current task context.',
          success: false,
        };
      }

      try {
        const result = await taskCaller.run({
          continueTopicId: args.continueTopicId,
          id,
          prompt: args.prompt,
        });

        const topicId = (result as { topicId?: string } | undefined)?.topicId;
        const operationId = (result as { operationId?: string } | undefined)?.operationId;
        const lines = [`Task ${id} started.`];
        if (topicId) lines.push(`  Topic: ${topicId}`);
        if (operationId) lines.push(`  Operation: ${operationId}`);

        return { content: lines.join('\n'), success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to run task';
        return { content: `Failed to run task ${id}: ${message}`, success: false };
      }
    },

    runTasks: async (args: { identifiers: string[] }) => {
      const identifiers = Array.isArray(args.identifiers)
        ? args.identifiers.map((value) => value?.trim()).filter((value): value is string => !!value)
        : [];

      if (identifiers.length === 0) {
        return { content: 'No task identifiers provided.', success: false };
      }

      const lines: string[] = [];
      let succeeded = 0;
      let failed = 0;

      for (const [index, identifier] of identifiers.entries()) {
        try {
          const result = await taskCaller.run({ id: identifier });
          const topicId = (result as { topicId?: string } | undefined)?.topicId;
          succeeded += 1;
          lines.push(
            `${index + 1}. ${identifier} — started${topicId ? ` (topic ${topicId})` : ''}`,
          );
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : 'Unknown error';
          lines.push(`${index + 1}. ${identifier} — failed: ${message}`);
        }
      }

      const header =
        failed === 0
          ? `Started ${succeeded} task${succeeded === 1 ? '' : 's'}:`
          : `Started ${succeeded}/${identifiers.length} tasks (${failed} failed):`;

      return {
        content: [header, ...lines].join('\n'),
        success: failed === 0,
      };
    },

    updateTaskComment: async (args: { commentId: string; content: string }) => {
      try {
        await taskCaller.updateComment({ commentId: args.commentId, content: args.content });
        return {
          content: `Comment ${args.commentId} updated.`,
          success: true,
          state: { commentId: args.commentId, success: true },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update task comment';
        return { content: `Failed to update task comment: ${message}`, success: false };
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
  };
};

export const taskRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Task tool execution');
    }

    const agentModel = new AgentModel(context.serverDB, context.userId);
    const taskModel = new TaskModel(context.serverDB, context.userId);
    const taskService = new TaskService(context.serverDB, context.userId);
    const taskCaller = taskRouter.createCaller({ userId: context.userId });

    return createTaskRuntime({
      agentModel,
      agentId: context.agentId,
      scope: context.scope,
      taskCaller,
      taskId: context.taskId,
      taskModel,
      taskService,
    });
  },
  identifier: TaskIdentifier,
};
