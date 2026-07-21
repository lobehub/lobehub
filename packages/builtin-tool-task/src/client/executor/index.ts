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
import type {
  BuiltinToolContext,
  BuiltinToolResult,
  TaskAutomationMode,
  TaskStatus,
  ToolAfterCallContext,
} from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { taskService } from '@/services/task';
import { getChatStoreState } from '@/store/chat';
import { getTaskStoreState } from '@/store/task';
import { findSubtaskParentId } from '@/store/task/slices/detail/reducer';

import { normalizeListTasksParams } from '../../listTasks';
import { TaskIdentifier } from '../../manifest';
import type {
  AddTaskCommentParams,
  CreateTaskParams,
  CreateTasksItemResult,
  DeleteTaskCommentParams,
  RunTasksItemResult,
  UpdateTaskCommentParams,
} from '../../types';
import { TaskApiName } from '../../types';

const log = debug('lobe-task:executor');

// In-app (SPA) deep-link base for tasks: a relative path so it resolves against
// the current origin and stays durable. Workspace-scoped tasks live under
// `/{slug}/task/...`, so prefix the active workspace slug when there is one.
const taskLinkBaseUrl = (): string | undefined => {
  const slug = getActiveWorkspaceSlug();
  return slug ? `/${slug}` : undefined;
};

// APIs whose execution mutates state that's surfaced in the renderer's task
// list or detail caches. Used by `onAfterCall` to decide what to revalidate.
const LIST_MUTATING_APIS = new Set<string>([
  TaskApiName.createTask,
  TaskApiName.createTasks,
  TaskApiName.deleteTask,
  TaskApiName.editTask,
  TaskApiName.runTask,
  TaskApiName.runTasks,
  TaskApiName.setTaskSchedule,
  TaskApiName.updateTaskStatus,
]);

const DETAIL_MUTATING_APIS = new Set<string>([
  TaskApiName.addTaskComment,
  TaskApiName.deleteTaskComment,
  TaskApiName.editTask,
  TaskApiName.runTask,
  TaskApiName.setTaskSchedule,
  TaskApiName.setTaskVerify,
  TaskApiName.updateTaskComment,
  TaskApiName.updateTaskStatus,
  TaskApiName.viewTask,
]);

const extractIdentifier = (params: unknown, result: BuiltinToolResult): string | undefined => {
  const fromState = (result.state as { identifier?: unknown } | undefined)?.identifier;
  if (typeof fromState === 'string' && fromState.length > 0) return fromState;
  const fromParams = (params as { identifier?: unknown } | null | undefined)?.identifier;
  if (typeof fromParams === 'string' && fromParams.length > 0) return fromParams;
  return undefined;
};

class TaskExecutor extends BaseExecutor<typeof TaskApiName> {
  readonly identifier = TaskIdentifier;
  protected readonly apiEnum = TaskApiName;

  onAfterCall = async ({ apiName, params, result }: ToolAfterCallContext): Promise<void> => {
    if (!result.success) return;

    const store = getTaskStoreState();
    const identifier = extractIdentifier(params, result);

    // Auto-expand the freshly created task's detail in the right-side portal so
    // the user can review it without leaving the conversation. This fires once
    // per `createTask` tool call (on the gateway `tool_end` event), which is why
    // it lives here rather than in the renderer: the gateway re-fetches and
    // remounts the message after `tool_end`, so a render-mount effect never sees
    // the undefined → defined identifier transition and would never open.
    if (apiName === TaskApiName.createTask && identifier) {
      getChatStoreState().openTaskDetail(identifier);
    }

    // Build the set of task-detail keys to revalidate. Mirrors the pattern
    // used by `updateTask` in the detail slice so subtask deletions / edits
    // bubble up: when we mutate a subtask we must also refresh the parent
    // whose `subtasks[]` array embeds it, otherwise the parent's view keeps
    // showing the stale child until a manual reload.
    const detailTargets = new Set<string>();
    const touchesDetail = DETAIL_MUTATING_APIS.has(apiName) || LIST_MUTATING_APIS.has(apiName);
    if (touchesDetail) {
      if (identifier) {
        // `deleteTask` is not in DETAIL_MUTATING_APIS (the row is gone), but
        // edit/status/etc. need their own detail key revalidated.
        if (DETAIL_MUTATING_APIS.has(apiName)) detailTargets.add(identifier);

        const parentId = findSubtaskParentId(store.taskDetailMap, identifier);
        if (parentId) detailTargets.add(parentId);
      }

      // Defensive: refresh whatever detail page the user is currently
      // viewing — covers e.g. a `createTask` whose new identifier we don't
      // yet know in the local map but whose parent the user is staring at.
      const { activeTaskId } = store;
      if (activeTaskId) detailTargets.add(activeTaskId);
    }

    const refreshes: Promise<unknown>[] = [];
    if (LIST_MUTATING_APIS.has(apiName)) {
      refreshes.push(store.refreshTaskList());
    }
    for (const id of detailTargets) {
      refreshes.push(store.internal_refreshTaskDetail(id));
    }

    if (refreshes.length === 0) return;
    await Promise.all(refreshes).catch((error) => {
      log('[TaskExecutor] onAfterCall - refresh failed:', error);
    });
  };

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

  /**
   * Shared single-task create used by both `createTask` and the `createTasks`
   * batch loop. Returns the raw {@link BuiltinToolResult}; Work registration is
   * driven by the manifest `work` config at the tool-execution dispatch layer
   * (`invokeExecutor`), not here.
   */
  #createTask = async (
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
          baseUrl: taskLinkBaseUrl(),
          identifier: task.identifier,
          instruction: params.instruction,
          name: task.name,
          parentLabel: parentIdentifier,
          priority: task.priority,
          status: task.status,
        }),
        // Structure the freshly-created task into `state` so the renderer and
        // the Debug "skill state" panel have real data without re-deriving from
        // `args` (the only other source after a conversation reopen).
        state: {
          description: task.description,
          identifier: task.identifier,
          name: task.name,
          parentIdentifier,
          priority: task.priority,
          status: task.status as TaskStatus,
          success: true,
          taskId: task.id,
        },
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
  ): Promise<BuiltinToolResult> => this.#createTask(params, ctx);

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

    for (const item of items) {
      const result = await this.#createTask(item, ctx);
      const success = result.success === true;
      const error = success
        ? undefined
        : result.error?.message ||
          (typeof result.content === 'string' ? result.content : 'Unknown error');
      const identifier = (result.state as { identifier?: string } | undefined)?.identifier;

      results.push({ error, identifier, name: item.name, success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;

    // Relative, workspace-aware links: this content is rendered in-app (SPA),
    // where a relative path resolves against the current origin and is more
    // durable than baking in one. The server runtime passes an absolute baseUrl
    // for IM / mobile.
    return {
      content: formatTasksCreated(results, taskLinkBaseUrl()),
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
        // Surface the deleted task's internal id so the manifest-driven dispatch
        // layer (`work: { action: 'delete' }`) can delete its Work + refresh the
        // conversation caches — the task row is gone, so the Work can only be
        // located by `works.resourceId = taskId`.
        state: { identifier: label, success: true, taskId: deleted?.id },
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

  setTaskSchedule = async (
    params: {
      automationMode?: TaskAutomationMode | null;
      heartbeatInterval?: number;
      identifier: string;
      maxExecutions?: number | null;
      schedulePattern?: string | null;
      scheduleTimezone?: string | null;
    },
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] setTaskSchedule - params:', params);

      const { identifier } = params;
      const store = getTaskStoreState();
      const changes: string[] = [];
      const ops: Promise<unknown>[] = [];

      // Top-level schedule columns — direct service.update bypasses the
      // store.updateTask optimistic path, which would otherwise need to map
      // flat columns onto the detail's nested `schedule.*` shape.
      const scheduleUpdate: {
        automationMode?: TaskAutomationMode | null;
        heartbeatInterval?: number;
        schedulePattern?: string | null;
        scheduleTimezone?: string | null;
      } = {};
      if (params.automationMode !== undefined) {
        scheduleUpdate.automationMode = params.automationMode;
        changes.push(
          params.automationMode
            ? `automation mode → ${params.automationMode}`
            : 'automation disabled',
        );
      }
      if (params.heartbeatInterval !== undefined) {
        scheduleUpdate.heartbeatInterval = params.heartbeatInterval;
        changes.push(
          params.heartbeatInterval > 0
            ? `heartbeat interval → ${params.heartbeatInterval}s`
            : 'heartbeat interval cleared',
        );
      }
      if (params.schedulePattern !== undefined) {
        scheduleUpdate.schedulePattern = params.schedulePattern;
        changes.push(
          params.schedulePattern
            ? `schedule pattern → "${params.schedulePattern}"`
            : 'schedule pattern cleared',
        );
      }
      if (params.scheduleTimezone !== undefined) {
        scheduleUpdate.scheduleTimezone = params.scheduleTimezone;
        changes.push(
          params.scheduleTimezone
            ? `schedule timezone → ${params.scheduleTimezone}`
            : 'schedule timezone cleared',
        );
      }
      if (Object.keys(scheduleUpdate).length > 0) {
        ops.push(taskService.update(identifier, scheduleUpdate));
      }

      // maxExecutions lives in `tasks.config.schedule.maxExecutions` (JSONB);
      // route through updateConfig so the server-side merge preserves siblings
      // (checkpoint, review, model snapshot, etc).
      if (params.maxExecutions !== undefined) {
        ops.push(
          taskService.updateConfig(identifier, {
            schedule: { maxExecutions: params.maxExecutions },
          }),
        );
        changes.push(
          params.maxExecutions === null
            ? 'max executions cleared (unlimited)'
            : `max executions → ${params.maxExecutions}`,
        );
      }

      if (ops.length === 0) {
        return {
          content: 'No schedule fields provided; nothing to update.',
          error: { message: 'No schedule fields provided.', type: 'NoFields' },
          success: false,
        };
      }

      await Promise.all(ops);
      await store.internal_refreshTaskDetail(identifier);

      return {
        content: formatTaskEdited(identifier, changes),
        state: { automationMode: params.automationMode, identifier, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] setTaskSchedule - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to set task schedule';
      return {
        content: `Failed to set task schedule: ${message}`,
        error: { message, type: 'SetTaskScheduleFailed' },
        success: false,
      };
    }
  };

  setTaskVerify = async (
    params: {
      enabled?: boolean | null;
      identifier: string;
      maxIterations?: number | null;
      requirement?: string | null;
      verifierAgentId?: string | null;
      verifyCriteriaIds?: string[] | null;
      verifyRubricId?: string | null;
    },
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[TaskExecutor] setTaskVerify - params:', params);

      const { identifier } = params;

      // Only forward keys the caller actually provided. The TRPC contract
      // (task.updateVerifyConfig) treats `null` as "clear" and omission as
      // "leave untouched", so an undefined field must NOT reach the payload.
      const verify: {
        enabled?: boolean | null;
        maxIterations?: number | null;
        requirement?: string | null;
        verifierAgentId?: string | null;
        verifyCriteriaIds?: string[] | null;
        verifyRubricId?: string | null;
      } = {};
      const changes: string[] = [];

      if (params.enabled !== undefined) {
        verify.enabled = params.enabled;
        changes.push(
          params.enabled === null
            ? 'verify enabled cleared'
            : `verify ${params.enabled ? 'enabled' : 'disabled'}`,
        );
      }
      if (params.requirement !== undefined) {
        verify.requirement = params.requirement;
        changes.push(
          params.requirement ? 'acceptance requirement set' : 'acceptance requirement cleared',
        );
      }
      if (params.maxIterations !== undefined) {
        verify.maxIterations = params.maxIterations;
        changes.push(
          params.maxIterations === null
            ? 'max iterations cleared'
            : `max iterations → ${params.maxIterations}`,
        );
      }
      if (params.verifierAgentId !== undefined) {
        verify.verifierAgentId = params.verifierAgentId;
        changes.push(
          params.verifierAgentId
            ? `verifier agent → ${params.verifierAgentId}`
            : 'verifier agent cleared',
        );
      }
      if (params.verifyRubricId !== undefined) {
        verify.verifyRubricId = params.verifyRubricId;
        changes.push(
          params.verifyRubricId
            ? `verify rubric → ${params.verifyRubricId}`
            : 'verify rubric cleared',
        );
      }
      if (params.verifyCriteriaIds !== undefined) {
        verify.verifyCriteriaIds = params.verifyCriteriaIds;
        changes.push(
          params.verifyCriteriaIds?.length
            ? `verify criteria → ${params.verifyCriteriaIds.length} item(s)`
            : 'verify criteria cleared',
        );
      }

      if (Object.keys(verify).length === 0) {
        return {
          content: 'No verify fields provided; nothing to update.',
          error: { message: 'No verify fields provided.', type: 'NoFields' },
          success: false,
        };
      }

      await taskService.updateVerifyConfig({ id: identifier, verify });
      await getTaskStoreState().internal_refreshTaskDetail(identifier);

      return {
        content: formatTaskEdited(identifier, changes),
        state: { enabled: params.enabled, identifier, success: true },
        success: true,
      };
    } catch (error) {
      log('[TaskExecutor] setTaskVerify - error:', error);
      const message = error instanceof Error ? error.message : 'Failed to set task verify config';
      return {
        content: `Failed to set task verify config: ${message}`,
        error: { message, type: 'SetTaskVerifyFailed' },
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
      await getTaskStoreState().updateComment(params.commentId, params.content, {
        taskId: ctx?.taskId ?? undefined,
      });

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
      // Work chips read live task status via the message-list summary join;
      // settle-time refresh (WorksSection / gateway tool_end) picks it up —
      // avoid a full `message:list` revalidate on every status tool call.

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
