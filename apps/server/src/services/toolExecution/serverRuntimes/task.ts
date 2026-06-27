import { normalizeListTasksParams, TaskIdentifier } from '@lobechat/builtin-tool-task';
import type { LobeChatDatabase } from '@lobechat/database';
import type { TaskCreatedItem } from '@lobechat/prompts';
import {
  formatDependencyAdded,
  formatDependencyRemoved,
  formatTaskCreated,
  formatTaskDeleted,
  formatTaskDetail,
  formatTaskEdited,
  formatTaskList,
  formatTasksCreated,
  priorityLabel,
} from '@lobechat/prompts';
import type { TaskAutomationMode, TaskStatus } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { TaskModel } from '@/database/models/task';
import { WorkspaceModel } from '@/database/models/workspace';
import { tasks } from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { taskRouter } from '@/server/routers/lambda/task';
import { TaskService } from '@/server/services/task';

import { type ServerRuntimeRegistration } from './types';

// Row-level workspace resolution: the agent runtime hasn't threaded
// `workspaceId` into `ToolExecutionContext` yet. When the tool fires inside a
// task we derive the workspace from that task row; otherwise we fall back to
// personal mode.
const resolveWorkspaceId = async (
  db: LobeChatDatabase,
  taskId: string | undefined,
): Promise<string | undefined> => {
  if (!taskId) return undefined;
  const [row] = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.workspaceId ?? undefined;
};

export interface TaskRuntimeDeps {
  agentId?: string;
  agentModel: AgentModel;
  // Assistant message that carried the createTask tool call — the tool-call
  // anchor, NOT the source user message. Recorded as `context.origin.messageId`.
  assistantMessageId?: string;
  // Pointers to the conversation that invoked the createTask tool. Recorded into
  // `tasks.context.origin` so the task's handoff result can later be delivered
  // back to this session. All optional — a task can be created
  // outside an agent turn (e.g. via the API).
  operationId?: string;
  // Resolves the base URL for task deep-links: app origin + optional `/{slug}`
  // workspace prefix. Provided by the factory (which owns db / userId / the
  // resolved workspaceId); when absent (unit tests) links fall back to the bare
  // app origin.
  resolveLinkBaseUrl?: () => Promise<string>;
  scope?: string | null;
  taskCaller: ReturnType<typeof taskRouter.createCaller>;
  taskId?: string;
  taskModel: TaskModel;
  taskService: TaskService;
  toolCallId?: string;
  topicId?: string;
}

export const createTaskRuntime = (deps: TaskRuntimeDeps) => {
  const { agentId, assistantMessageId, operationId, scope, taskId, toolCallId, topicId } = deps;
  // Models are read through `deps` (not destructured) so callers can swap them
  // in lazily — e.g. after async workspace resolution in the runtime factory.
  const agentModel = () => deps.agentModel;
  const taskModel = () => deps.taskModel;
  const taskService = () => deps.taskService;
  const taskCaller = () => deps.taskCaller;

  // Base URL for task deep-links embedded in tool results. These results can be
  // pushed to IM / bot channels and mobile, so the link must be ABSOLUTE — and
  // workspace-scoped tasks live under `/{slug}/task/...`, so the slug has to be
  // in the path too or the link resolves to the wrong (personal) scope. The
  // factory supplies the workspace-aware resolver; fall back to the bare origin.
  const taskLinkBaseUrl = async (): Promise<string> =>
    (await deps.resolveLinkBaseUrl?.()) ?? appEnv.APP_URL.replace(/\/$/, '');

  const resolveAssigneeAgent = async (assigneeAgentId?: string | null) => {
    if (!assigneeAgentId) return { success: true } as const;

    const exists = await agentModel().existsById(assigneeAgentId);
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
      const parent = await taskModel().resolve(args.parentIdentifier);
      if (!parent)
        return { content: `Parent task not found: ${args.parentIdentifier}`, success: false };
      parentTaskId = parent.id;
      parentLabel = parent.identifier;
    }

    const assigneeResult = await resolveAssigneeAgent(args.assigneeAgentId);
    if (!assigneeResult.success) return { content: assigneeResult.content, success: false };

    // Capture where this task was spawned from so the lifecycle can later
    // bridge the handoff result back to the creator conversation.
    // Only persist the pocket when we actually have a creator agent + topic;
    // tasks created outside an agent turn (e.g. via API) have no origin.
    const origin =
      agentId && topicId
        ? { agentId, messageId: assistantMessageId, operationId, toolCallId, topicId }
        : undefined;

    const task = await taskService().createTask({
      assigneeAgentId: args.assigneeAgentId ?? (scope === 'task' ? undefined : agentId),
      context: origin ? { origin } : undefined,
      createdByAgentId: agentId,
      instruction: args.instruction,
      name: args.name,
      parentTaskId,
      priority: args.priority,
      sortOrder: args.sortOrder,
    });

    return {
      content: formatTaskCreated({
        // Absolute, workspace-scoped link: this content can be pushed to IM /
        // bot channels and mobile, where a relative path has no app origin to
        // resolve against and the `/{slug}` prefix would otherwise be lost.
        baseUrl: await taskLinkBaseUrl(),
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
        const result = await taskCaller().addComment({
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
      const { identifier, ...rest } = await createTaskImpl(args);
      // Surface the created task identifier as plugin state (mirrors the client
      // executor's `{ identifier, success }`) so the inline render can link to
      // the task detail. Without this the tool message persists no state and the
      // card has nothing to open.
      return identifier ? { ...rest, state: { identifier, success: rest.success } } : rest;
    },

    createTasks: async (args: { tasks: CreateTaskArgs[] }) => {
      const items = Array.isArray(args.tasks) ? args.tasks : [];
      if (items.length === 0) {
        return { content: 'No tasks provided.', success: false };
      }

      const results: TaskCreatedItem[] = [];

      for (const item of items) {
        try {
          const result = await createTaskImpl(item);
          results.push({
            error: result.success ? undefined : result.content,
            identifier: result.identifier,
            name: item.name,
            success: result.success,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          results.push({ error: message, name: item.name, success: false });
        }
      }

      const failed = results.filter((r) => !r.success).length;

      return {
        // Absolute, workspace-scoped links so the summary stays clickable when
        // pushed to IM / mobile.
        content: formatTasksCreated(results, await taskLinkBaseUrl()),
        success: failed === 0,
      };
    },

    deleteTask: async (args: { identifier: string }) => {
      const task = await taskModel().resolve(args.identifier);
      if (!task) return { content: `Task not found: ${args.identifier}`, success: false };

      await taskModel().delete(task.id);

      return {
        content: formatTaskDeleted(task.identifier, task.name),
        success: true,
      };
    },

    deleteTaskComment: async (args: { commentId: string }) => {
      try {
        await taskCaller().deleteComment({ commentId: args.commentId });
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
      const task = await taskModel().resolve(args.identifier);
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
        ops.push(taskCaller().update({ id: task.id, ...updateData }));
      }

      const applyDeps = async (
        ids: string[],
        apply: (depId: string) => Promise<unknown>,
        onChange: (depIdentifier: string) => void,
      ): Promise<string | undefined> => {
        const resolved = await Promise.all(
          ids.map((id) =>
            taskModel()
              .resolve(id)
              .then((r) => ({ id, resolved: r })),
          ),
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
            (depId) => taskModel().addDependency(task.id, depId),
            (depIdentifier) => changes.push(formatDependencyAdded(task.identifier, depIdentifier)),
          ),
        );
      }
      if (args.removeDependencies?.length) {
        depResults.push(
          applyDeps(
            args.removeDependencies,
            (depId) => taskModel().removeDependency(task.id, depId),
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
        const result = await taskCaller().list(normalized.query);

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
      const task = await taskModel().resolve(args.identifier);
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
        ops.push(taskCaller().update({ id: task.id, ...scheduleUpdate }));
      }

      if (args.maxExecutions !== undefined) {
        ops.push(
          taskCaller().updateConfig({
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

    setTaskVerify: async (args: {
      enabled?: boolean | null;
      identifier: string;
      maxIterations?: number | null;
      requirement?: string | null;
      verifierAgentId?: string | null;
      verifyCriteriaIds?: string[] | null;
      verifyRubricId?: string | null;
    }) => {
      const task = await taskModel().resolve(args.identifier);
      if (!task) return { content: `Task not found: ${args.identifier}`, success: false };

      // Mirrors the client executor: only forward keys the caller actually
      // provided. The TRPC contract (task.updateVerifyConfig) treats `null` as
      // "clear" and omission as "leave untouched", so an undefined field must
      // NOT reach the payload.
      const verify: {
        enabled?: boolean | null;
        maxIterations?: number | null;
        requirement?: string | null;
        verifierAgentId?: string | null;
        verifyCriteriaIds?: string[] | null;
        verifyRubricId?: string | null;
      } = {};
      const changes: string[] = [];

      if (args.enabled !== undefined) {
        verify.enabled = args.enabled;
        changes.push(
          args.enabled === null
            ? 'verify enabled cleared'
            : `verify ${args.enabled ? 'enabled' : 'disabled'}`,
        );
      }
      if (args.requirement !== undefined) {
        verify.requirement = args.requirement;
        changes.push(
          args.requirement ? 'acceptance requirement set' : 'acceptance requirement cleared',
        );
      }
      if (args.maxIterations !== undefined) {
        verify.maxIterations = args.maxIterations;
        changes.push(
          args.maxIterations === null
            ? 'max iterations cleared'
            : `max iterations → ${args.maxIterations}`,
        );
      }
      if (args.verifierAgentId !== undefined) {
        verify.verifierAgentId = args.verifierAgentId;
        changes.push(
          args.verifierAgentId
            ? `verifier agent → ${args.verifierAgentId}`
            : 'verifier agent cleared',
        );
      }
      if (args.verifyRubricId !== undefined) {
        verify.verifyRubricId = args.verifyRubricId;
        changes.push(
          args.verifyRubricId ? `verify rubric → ${args.verifyRubricId}` : 'verify rubric cleared',
        );
      }
      if (args.verifyCriteriaIds !== undefined) {
        verify.verifyCriteriaIds = args.verifyCriteriaIds;
        changes.push(
          args.verifyCriteriaIds?.length
            ? `verify criteria → ${args.verifyCriteriaIds.length} item(s)`
            : 'verify criteria cleared',
        );
      }

      if (Object.keys(verify).length === 0) {
        return { content: 'No verify fields provided; nothing to update.', success: false };
      }

      await taskCaller().updateVerifyConfig({ id: task.id, verify });

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
        const result = await taskCaller().run({
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
          const result = await taskCaller().run({ id: identifier });
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
        await taskCaller().updateComment({ commentId: args.commentId, content: args.content });
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
        const result = await taskCaller().updateStatus({
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

      const detail = await taskService().getTaskDetail(id);
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

    const db = context.serverDB;
    const userId = context.userId;
    const { agentId, assistantMessageId, operationId, taskId, toolCallId, topicId, scope } =
      context;

    // Workspace slug for deep-links: resolved once (memoized) from the workspace
    // owning the created task (`workspaceId` is set by `ensureModels` below),
    // and only when the task is actually workspace-scoped.
    let workspaceId: string | undefined;
    let slugPromise: Promise<string | undefined> | undefined;
    const resolveLinkBaseUrl = async (): Promise<string> => {
      const origin = appEnv.APP_URL.replace(/\/$/, '');
      if (!workspaceId) return origin;
      slugPromise ??= new WorkspaceModel(db, userId)
        .findById(workspaceId)
        .then((workspace) => workspace?.slug ?? undefined)
        .catch(() => undefined);
      const slug = await slugPromise;
      return slug ? `${origin}/${slug}` : origin;
    };

    // Models are wired in lazily after the workspaceId is resolved from the
    // owning task row. `createTaskRuntime` reads them through this shared
    // `deps` object, so re-assigning the fields below propagates into every
    // method without re-creating the runtime.
    const deps = {
      agentId,
      assistantMessageId,
      operationId,
      resolveLinkBaseUrl,
      scope,
      taskId,
      toolCallId,
      topicId,
      // Initial personal-mode models cover the no-task-context case. Replaced
      // before the first call when `taskId` is set.
      agentModel: new AgentModel(db, userId),
      taskModel: new TaskModel(db, userId),
      taskService: new TaskService(db, userId),
      taskCaller: taskRouter.createCaller({ userId }),
    } as TaskRuntimeDeps;

    let resolved = false;
    const ensureModels = async () => {
      if (resolved) return;
      resolved = true;
      // Prefer pipeline-threaded `context.workspaceId`. Fall back to looking
      // up the owning task row for callers that pre-date the propagation work
      // and still construct `ToolExecutionContext` without `workspaceId`.
      const wsId = context.workspaceId ?? (await resolveWorkspaceId(db, taskId));
      workspaceId = wsId;
      deps.agentModel = new AgentModel(db, userId, wsId);
      deps.taskModel = new TaskModel(db, userId, wsId);
      deps.taskService = new TaskService(db, userId, wsId);
      deps.taskCaller = taskRouter.createCaller({ userId, workspaceId: wsId });
    };

    const baseRuntime = createTaskRuntime(deps);

    // Wrap every method so that workspaceId + models are resolved before the
    // delegate runs. Preserves the existing tool API shape.
    return Object.fromEntries(
      Object.entries(baseRuntime).map(([name, fn]) => [
        name,
        async (...args: unknown[]) => {
          await ensureModels();
          return (fn as (...a: unknown[]) => unknown)(...args);
        },
      ]),
    ) as typeof baseRuntime;
  },
  identifier: TaskIdentifier,
};
