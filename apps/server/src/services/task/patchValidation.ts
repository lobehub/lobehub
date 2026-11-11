import type { TaskContext } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import type { AgentModel } from '@/database/models/agent';
import { ProjectModel } from '@/database/models/project';
import type { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import type { EditLockService } from '@/server/services/editLock';
import type { TaskService } from '@/server/services/task';

import { assertArchivedTaskStaysIdle } from './archiveGuard';
import { assertTaskOriginPatchAllowed } from './originValidation';
import { assertPreciseScheduleAllowed, assertResultingScheduleValid } from './scheduleValidation';
import { findTaskOrThrow, resolveTaskOrThrow } from './utils';

/**
 * The invariants a task patch must satisfy, shared by every write boundary: the
 * tRPC mutation the in-app editor calls and the REST patch the OpenAPI SDK is
 * generated from. Both must refuse a patch the hierarchy, visibility or
 * assignment rules forbid — writing the row directly would otherwise persist
 * e.g. a task parented to itself (the foreign key accepts it) or a public child
 * under a private parent.
 */

type ResolvedTask = NonNullable<Awaited<ReturnType<TaskModel['resolve']>>>;

/**
 * The fields this helper reads off a patch. It is a *minimum*, not a whitelist:
 * a patch carries whatever other task columns the caller sent — they are passed
 * through untouched — hence the open index signature.
 */
export interface TaskPatchFields {
  [key: string]: unknown;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  automationMode?: string | null;
  context?: Record<string, unknown>;
  editorData?: unknown;
  instruction?: string | null;
  projectId?: string | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
}

export interface TaskPatchInvariantContext {
  agentModel: Pick<AgentModel, 'getAgentVisibility'>;
  editLockService: Pick<EditLockService, 'getBlockingHolder'>;
  serverDB: LobeChatDatabase;
  taskModel: TaskModel;
  taskService: Pick<
    TaskService,
    | 'assertAgentVisibilityCompat'
    | 'assertAssigneeUserVisibilityCompat'
    | 'assertParentVisibilityCompat'
  >;
  userId: string;
  workspaceId?: string;
}

export async function assertAssigneeAgentBelongsToUser(
  db: LobeChatDatabase,
  callerCtx: { userId: string; workspaceId?: string },
  assigneeAgentId?: string | null,
) {
  if (!assigneeAgentId) return;

  try {
    await assertAgentUsableBy(db, assigneeAgentId, callerCtx);
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
      // Preserve the task-context message so the UI surfaces "Assignee agent
      // not found" instead of the generic "Agent not found". Cross-user access
      // to a private agent still resolves to NOT_FOUND, never FORBIDDEN, so we
      // don't leak existence of someone else's private agent.
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignee agent not found' });
    }
    throw error;
  }
}

/**
 * A task patch may file the task under any project the caller can read — the
 * same bar `createTask` applies, and the same NOT_FOUND: another workspace's or
 * member's private project is indistinguishable from one that does not exist.
 */
async function assertProjectReadable(ctx: TaskPatchInvariantContext, projectId: string) {
  const project = await new ProjectModel(ctx.serverDB, ctx.userId, ctx.workspaceId).findById(
    projectId,
  );
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
}

/**
 * Moving a task leaves its subtasks and dependencies where they are, and neither
 * link may cross a project boundary (`createTask`, `addDependency` and reparenting
 * all enforce that), so a move that would split them is refused rather than
 * cascaded. A patch that also changes the parent is judged on the new parent by
 * `resolveSafeParentTaskId` instead.
 */
async function assertProjectMoveKeepsLinks(
  model: TaskModel,
  task: ResolvedTask,
  projectId: string | null,
  parentChanges: boolean,
) {
  if (!parentChanges && task.parentTaskId) {
    const parent = await model.findById(task.parentTaskId);
    if (parent && parent.projectId !== projectId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Subtask must belong to the same project as its parent',
      });
    }
  }

  if (await model.hasSubtaskOutsideProject(task.id, projectId)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task has subtasks in its current project. Move or detach them first',
    });
  }

  if (await model.hasDependencyOutsideProject(task.id, projectId)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task dependencies cannot cross project boundaries. Remove them first',
    });
  }
}

async function resolveSafeParentTaskId(
  model: TaskModel,
  taskId: string,
  parentTaskId: string | null,
  projectId: string | null,
): Promise<string | null> {
  if (parentTaskId === null) return null;

  const parent = await findTaskOrThrow(model, parentTaskId);
  if (parent.id === taskId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task cannot be parented to itself',
    });
  }

  const descendants = await model.findAllDescendants(taskId);
  if (descendants.some((task) => task.id === parent.id)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task cannot be parented to its own descendant',
    });
  }

  if (projectId !== parent.projectId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Parent task must belong to the same project',
    });
  }

  return parent.id;
}

/**
 * Resolve the task being patched and reject the patch if it breaks an existing
 * invariant, returning the data the row write should use (with `parentTaskId`
 * resolved and the stale rich-text mirror dropped).
 *
 * The order of the checks is load-bearing — the assignee agent is validated
 * before the task is resolved so a bad agent reports itself rather than a
 * missing task — and is kept identical for both boundaries.
 */
export async function resolveTaskPatchInvariants<Data extends TaskPatchFields>(
  ctx: TaskPatchInvariantContext,
  params: { data: Data; id: string; parentTaskId?: string | null },
): Promise<{ data: Data & { parentTaskId?: string | null }; resolved: ResolvedTask }> {
  const { id, parentTaskId } = params;
  let { data } = params;

  await assertAssigneeAgentBelongsToUser(
    ctx.serverDB,
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    data.assigneeAgentId,
  );

  const resolved = await resolveTaskOrThrow(ctx.taskModel, id);
  assertResultingScheduleValid(resolved, data);
  await assertPreciseScheduleAllowed(
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    resolved.schedulePattern,
    data.schedulePattern,
  );
  assertArchivedTaskStaysIdle(resolved, data);
  // `context` replaces the whole column, origin included: a changed origin
  // must point at the caller's own conversation like it must at create time.
  if (data.context !== undefined) {
    const origin = await assertTaskOriginPatchAllowed(
      ctx.serverDB,
      { userId: ctx.userId, workspaceId: ctx.workspaceId },
      (resolved.context as TaskContext | null)?.origin,
      data.context?.origin,
    );
    if (origin !== undefined) data = { ...data, context: { ...data.context, origin } };
  }

  // Collaborative edit lock: reject writes to a workspace task another member
  // is actively editing. Inert until a client acquires the lock.
  if (ctx.workspaceId) {
    const blockedBy = await ctx.editLockService.getBlockingHolder('task', resolved.id);
    if (blockedBy) {
      throw new TRPCError({
        cause: { data: { code: 'DocumentLocked' } },
        code: 'CONFLICT',
        message: 'Task is being edited by another user',
      });
    }
  }

  // Reject changing the assignee to a private agent on a public task — a public
  // task must never be assigned to a private agent. `undefined` means "no
  // change"; `null` clears the assignee and is always safe.
  if (data.assigneeAgentId) {
    const agentVisibility = await ctx.agentModel.getAgentVisibility(data.assigneeAgentId);
    ctx.taskService.assertAgentVisibilityCompat(resolved.visibility, agentVisibility);
  }

  // A private task can only be assigned to its creator — the assignee would
  // otherwise never see the task. `null` clears and is always safe.
  ctx.taskService.assertAssigneeUserVisibilityCompat(
    resolved.visibility,
    data.assigneeUserId,
    resolved.createdByUserId,
  );

  // `undefined` means "no change"; `null` takes the task out of its project and
  // needs no target to check. An empty string is a target and fails as unknown.
  if (data.projectId !== undefined && data.projectId !== null) {
    await assertProjectReadable(ctx, data.projectId);
  }
  const resultingProjectId = data.projectId === undefined ? resolved.projectId : data.projectId;
  if (resultingProjectId !== resolved.projectId) {
    await assertProjectMoveKeepsLinks(
      ctx.taskModel,
      resolved,
      resultingProjectId,
      parentTaskId !== undefined,
    );
  }

  // Judged against the project this patch leaves the task in, so one patch can
  // move a task and reparent it under a task of the new project together.
  const resolvedParentTaskId =
    parentTaskId === undefined
      ? undefined
      : await resolveSafeParentTaskId(
          ctx.taskModel,
          resolved.id,
          parentTaskId === null ? null : (await resolveTaskOrThrow(ctx.taskModel, parentTaskId)).id,
          resultingProjectId,
        );

  // Reparenting a public task under a private one breaks the parent visibility
  // invariant — a subtask cannot be more public than its parent (otherwise
  // workspace members would still see the child while its new parent is
  // hidden). `undefined` means "no change"; `null` clears the parent and is
  // always safe.
  if (resolvedParentTaskId) {
    const newParent = await ctx.taskModel.findById(resolvedParentTaskId);
    ctx.taskService.assertParentVisibilityCompat(resolved.visibility, newParent?.visibility);
  }

  const updateData =
    parentTaskId === undefined ? data : { ...data, parentTaskId: resolvedParentTaskId };

  // `instruction` is the markdown source of truth while `editorData` is its
  // rich-text mirror. Text-only callers (for example the editTask builtin)
  // cannot produce Lexical JSON, so discard the stale mirror and let the editor
  // rebuild from markdown. Callers that provide both fields keep their explicit
  // editor state.
  const normalizedData =
    updateData.instruction !== undefined && updateData.editorData === undefined
      ? { ...updateData, editorData: null }
      : updateData;

  return { data: normalizedData, resolved };
}
