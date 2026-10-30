import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { router } from '@/libs/trpc/lambda';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import { TaskService } from '@/server/services/task';
import { notifyAssignedBestEffort } from '@/server/services/task/assignmentNotification';
import { resolveTaskPatchInvariants } from '@/server/services/task/patchValidation';
import {
  schedulePatternSchema,
  scheduleTimezoneSchema,
} from '@/server/services/task/scheduleValidation';
import { normalizeTaskConfig, resolveTaskOrThrow } from '@/server/services/task/utils';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';

import { idInput, taskProcedureWrite } from './procedures';

const updateSchema = z.object({
  assigneeAgentId: z.string().nullish(),
  assigneeUserId: z.string().nullish(),
  automationMode: z.enum(['heartbeat', 'schedule']).nullish(),
  config: z.record(z.string(), z.unknown()).optional(),
  // Deep-merged into `config` under the update's row lock rather than
  // replacing it — for a client editing one config key alongside columns.
  configPatch: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
  editorData: z.unknown().optional(),
  // 0 clears the interval (disables heartbeat); any positive value must be
  // ≥600s (10 min) to match the UI minimum and prevent sub-minute ticks if an
  // LLM calls setTaskSchedule with a tiny number.
  heartbeatInterval: z
    .number()
    .int()
    .refine((v) => v === 0 || v >= 600, {
      message: 'heartbeatInterval must be 0 (disabled) or at least 600 seconds (10 minutes)',
    })
    .optional(),
  heartbeatTimeout: z.number().min(1).nullish(),
  instruction: z.string().optional(),
  name: z.string().optional(),
  parentTaskId: z.string().nullish(),
  priority: z.number().min(0).max(4).optional(),
  schedulePattern: schedulePatternSchema.nullish(),
  scheduleTimezone: scheduleTimezoneSchema.nullish(),
  status: z.enum(TASK_STATUSES).optional(),
});

/**
 * Who an activity row is attributed to.
 *
 * A server-side caller (the gateway task runtime) carries the agent in
 * `ctx.actingAgentId`, which no HTTP request can set — that is the trusted
 * path and always wins. The client-first runtime (gateway off, self-hosted)
 * has no such channel: its task tools are ordinary TRPC calls from the
 * browser, so it names the agent in the payload — the same contract
 * `addComment.authorAgentId` already uses — and the claim is honoured only
 * for an agent the caller can use. That bounds any misattribution to the
 * caller's own agents rather than letting a request pin a change on anyone.
 */
async function resolveActivityActor(
  ctx: {
    actingAgentId?: string | null;
    serverDB: LobeChatDatabase;
    userId: string;
    workspaceId?: string | null;
  },
  claimedAgentId?: string,
): Promise<{ agentId?: string | null; userId: string }> {
  if (ctx.actingAgentId) return { agentId: ctx.actingAgentId, userId: ctx.userId };
  if (claimedAgentId) {
    await assertAgentUsableBy(ctx.serverDB, claimedAgentId, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId ?? undefined,
    });
  }
  return { agentId: claimedAgentId ?? null, userId: ctx.userId };
}

export const updateRouter = router({
  update: taskProcedureWrite
    .input(idInput.merge(updateSchema).extend({ actorAgentId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const {
        actorAgentId,
        configPatch: rawConfigPatch,
        id,
        parentTaskId,
        status,
        ...data
      } = input;
      try {
        const model = ctx.taskModel;
        const actor = await resolveActivityActor(ctx, actorAgentId);
        // Hierarchy, visibility and assignment invariants — shared with the
        // REST patch boundary so the two cannot drift.
        const { data: normalizedUpdateData, resolved } = await resolveTaskPatchInvariants(
          {
            agentModel: ctx.agentModel,
            editLockService: ctx.editLockService,
            serverDB: ctx.serverDB,
            taskModel: model,
            taskService: ctx.taskService,
            userId: ctx.userId,
            workspaceId: ctx.workspaceId ?? undefined,
          },
          { data, id, parentTaskId },
        );
        const configPatch = await normalizeTaskConfig(model, rawConfigPatch, resolved.config);
        if (normalizedUpdateData.config) {
          normalizedUpdateData.config = await normalizeTaskConfig(
            model,
            normalizedUpdateData.config,
            resolved.config,
          );
        }
        // Agent attribution comes from `resolveActivityActor` above. The
        // assignment activity is written inside this update's own transaction
        // (see `TaskModel.updateWithLog`), so a concurrent reassignment cannot
        // interleave between reading the old assignee and recording it.
        const task = status
          ? await ctx.serverDB.transaction(async (tx) => {
              const taskService = new TaskService(tx, ctx.userId, ctx.workspaceId ?? undefined);
              const updated = await taskService.updateTaskWithAssigneeLock(
                resolved.id,
                normalizedUpdateData,
                actor,
                { configPatch },
              );
              if (!updated) return null;

              const result = await taskService.updateStatus({ id: resolved.id, status }, actor);
              return result.task;
            })
          : await ctx.taskService.updateTaskWithAssigneeLock(
              resolved.id,
              normalizedUpdateData,
              actor,
              { configPatch },
            );
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        // Only an actual assignee change notifies — re-saving the same assignee
        // stays silent (self-assignment is filtered inside the helper).
        if (task.assigneeUserId !== resolved.assigneeUserId) {
          notifyAssignedBestEffort(ctx, task);
        }
        return { data: task, message: 'Task updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:update]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update task',
        });
      }
    }),
  updateVisibility: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          // A member making someone else's public task private takes it over:
          // it becomes their private task. Opt-in, so a plain demotion by a
          // non-creator still fails instead of silently moving the task.
          takeOwnership: z.boolean().optional(),
          visibility: z.enum(['private', 'public']),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const resolved = await resolveTaskOrThrow(ctx.taskModel, input.id);
        const takeOwnership =
          !!ctx.workspaceId &&
          !!input.takeOwnership &&
          input.visibility === 'private' &&
          resolved.createdByUserId !== ctx.userId;

        // Mirror the edit-lock contract from `update`: reject visibility flips
        // while another workspace member is actively editing this task. Without
        // this check a collaborator could silently retitle a private task to
        // public (or vice versa) while you're mid-edit.
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

        // The creator can always change visibility on their own tasks. In
        // workspace mode, workspace owners may still promote other members'
        // tasks (mirrors the transferTask policy at line ~1166). Demoting
        // someone else's task leaves it in the creator's private list, so a
        // non-creator may only demote by taking the task over as their own.
        if (ctx.workspaceId && resolved.createdByUserId !== ctx.userId && !takeOwnership) {
          if (input.visibility === 'private') {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Only the task creator can make this task private',
            });
          }
          const canOverride = await hasWorkspaceScopedPermission({
            action: 'AGENT_UPDATE',
            db: ctx.serverDB,
            scopes: ['ALL'],
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
          });
          if (!canOverride) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Only the task creator or workspace owner can change visibility',
            });
          }
        }

        // Runs are attributed to the creator; moving ownership under a live run
        // would leave it finishing as the previous creator.
        if (takeOwnership) {
          const subtree = [resolved, ...(await ctx.taskModel.findAllDescendants(resolved.id))];
          if (subtree.some((task) => task.status === 'running')) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot take over this task while it or a subtask is running.',
            });
          }
        }

        // Demoting a mixed-creator subtree would fracture it: each descendant
        // stays owned by its creator, so the root creator loses other
        // members' subtasks while those members keep orphaned children whose
        // parent is hidden. Reject early — the subtree must be single-creator
        // to go private.
        if (input.visibility === 'private') {
          const hasOtherCreators = await ctx.taskModel.subtreeHasOtherCreators(
            resolved.id,
            resolved.createdByUserId,
          );
          if (hasOtherCreators) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Cannot make this task private while it has subtasks created by other members. Reassign or remove those subtasks first.',
            });
          }
        }

        // A member assignee does not block demotion: the subtree write clears
        // every assignee other than the creator in the same transaction, since
        // the task disappears from that member's view (see
        // `setSubtreeVisibility`).

        // A private assignee agent on a public task breaks the visibility
        // invariant. Reject early — reassign first, then promote.
        if (input.visibility === 'public' && resolved.assigneeAgentId) {
          const agentVisibility = await ctx.agentModel.getAgentVisibility(resolved.assigneeAgentId);
          ctx.taskService.assertAgentVisibilityCompat(input.visibility, agentVisibility);
        }

        // A public subtask under a private parent would be orphaned in the
        // workspace view — a subtask cannot be more public than its parent.
        // The user must promote the parent chain first, or keep it private.
        if (input.visibility === 'public' && resolved.parentTaskId) {
          const parent = await ctx.taskModel.findById(resolved.parentTaskId);
          ctx.taskService.assertParentVisibilityCompat(input.visibility, parent?.visibility);
        }

        const updated = await ctx.taskSubtree.updateVisibility(resolved.id, input.visibility, {
          takeOwnership,
        });
        if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return { data: updated, message: 'Task visibility updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateVisibility]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update task visibility',
        });
      }
    }),
  updateConfig: taskProcedureWrite
    .input(idInput.merge(z.object({ config: z.record(z.string(), z.unknown()) })))
    .mutation(async ({ input, ctx }) => {
      const { id, config } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveTaskOrThrow(model, id);
        const task = await model.updateTaskConfig(
          resolved.id,
          (await normalizeTaskConfig(model, config, resolved.config))!,
        );
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return { data: task, message: 'Config updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateConfig]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update task config',
        });
      }
    }),
  updateStatus: taskProcedureWrite
    .input(
      z.object({
        actorAgentId: z.string().optional(),
        error: z.string().optional(),
        id: z.string(),
        operationId: z.string().optional(),
        status: z.enum(TASK_STATUSES),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { actorAgentId, ...statusInput } = input;
      try {
        // A person (or their agent) changed it: record who. System
        // transitions call the service without an actor and stay silent.
        const actor = await resolveActivityActor(ctx, actorAgentId);
        const result = await ctx.taskService.updateStatus(
          { ...statusInput, id: (await resolveTaskOrThrow(ctx.taskModel, statusInput.id)).id },
          actor,
        );
        const {
          task,
          unlocked,
          paused,
          checkpointTriggered,
          allSubtasksDone,
          parentTaskId,
          completionDeferred,
        } = result;
        return {
          data: task,
          message: `Task ${input.status}`,
          success: true,
          ...(completionDeferred && { completionDeferred: true }),
          ...(unlocked.length > 0 && { unlocked }),
          unlockedTasks: result.unlockedTasks,
          pausedTasks: result.pausedTasks,
          ...(paused.length > 0 && { paused }),
          ...(checkpointTriggered && { checkpointTriggered: true }),
          ...(allSubtasksDone && { allSubtasksDone: true, parentTaskId }),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateStatus]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update status',
        });
      }
    }),
  updateStatusCascade: taskProcedureWrite
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['canceled', 'completed']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.taskService.updateStatusCascade(
          { ...input, id: (await resolveTaskOrThrow(ctx.taskModel, input.id)).id },
          await resolveActivityActor(ctx),
        );
        return { data: result, message: `Task family ${input.status}`, success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateStatusCascade]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update task family status',
        });
      }
    }),
  acquireTaskLock: taskProcedureWrite.input(idInput).mutation(async ({ ctx, input }) => {
    if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
    const resolved = await resolveTaskOrThrow(ctx.taskModel, input.id);
    const prev = await ctx.editLockService.getActiveHolder('task', resolved.id);
    const result = await ctx.editLockService.acquire('task', resolved.id);
    if ((result.holderId ?? null) !== (prev ?? null)) {
      void publishResourceEvent(
        { id: resolved.id, type: 'task' },
        { actorId: ctx.userId, data: { holderId: result.holderId }, type: 'lock.changed' },
      );
    }
    return result;
  }),
  getTaskLock: taskProcedureWrite.input(idInput).query(async ({ ctx, input }) => {
    if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
    const resolved = await resolveTaskOrThrow(ctx.taskModel, input.id);
    const holder = await ctx.editLockService.getActiveHolder('task', resolved.id);
    return {
      expiresAt: null,
      holderId: holder ?? null,
      lockedByOther: Boolean(holder) && holder !== ctx.userId,
    };
  }),
  releaseTaskLock: taskProcedureWrite.input(idInput).mutation(async ({ ctx, input }) => {
    if (!ctx.workspaceId) return;
    const resolved = await resolveTaskOrThrow(ctx.taskModel, input.id);
    // Only broadcast "unlocked" when we actually released our own lock — if the
    // lease expired and another member took over, the lock is still held.
    const released = await ctx.editLockService.release('task', resolved.id);
    if (!released) return;
    void publishResourceEvent(
      { id: resolved.id, type: 'task' },
      { actorId: ctx.userId, data: { holderId: null }, type: 'lock.changed' },
    );
  }),
});
