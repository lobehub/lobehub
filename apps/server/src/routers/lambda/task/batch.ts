import type { TaskItem } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { TaskBatchService } from '@/server/services/task/batch';
import { TASK_BATCH_MAX_IDS, TASK_BATCH_STATUSES } from '@/server/services/task/batchLimits';
import { TaskBatchRevertService } from '@/server/services/task/batchRevert';

import { taskProcedureWrite } from './procedures';

const idsInput = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(TASK_BATCH_MAX_IDS),
});

const batchService = (ctx: {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}) => new TaskBatchService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);

/**
 * The list-visible columns of each changed row, so the client can confirm its
 * optimistic rows with server-computed values (`completedAt`, `updatedAt`)
 * without waiting for a list refetch. Only these columns: a full row carries
 * the instruction and config, which a 500-task batch has no reason to ship.
 */
const toChangedRow = (task: TaskItem) => ({
  assigneeAgentId: task.assigneeAgentId,
  assigneeUserId: task.assigneeUserId,
  completedAt: task.completedAt,
  id: task.id,
  priority: task.priority,
  status: task.status,
  updatedAt: task.updatedAt,
});

const revertValues = z.object({
  archived: z.boolean().optional(),
  assigneeAgentId: z.string().nullish(),
  assigneeUserId: z.string().nullish(),
  priority: z.number().int().min(0).max(4).nullish(),
  status: z.string().optional(),
});

const revertService = (ctx: {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}) => new TaskBatchRevertService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);

const rethrow = (scope: string, message: string) => (error: unknown) => {
  if (error instanceof TRPCError) throw error;
  console.error(`[task:${scope}]`, error);
  throw new TRPCError({ cause: error, code: 'INTERNAL_SERVER_ERROR', message });
};

/**
 * Multi-select actions of the task list. One request carries the whole
 * selection (up to {@link TASK_BATCH_MAX_IDS} raw task ids) and answers with a
 * per-task outcome: `updated`, `skipped` with a reason, or `failed`.
 */
export const batchRouter = router({
  batchArchive: taskProcedureWrite
    .input(idsInput.extend({ archived: z.boolean() }))
    .mutation(({ ctx, input }) =>
      batchService(ctx)
        .archive(input.ids, input.archived)
        .catch(rethrow('batchArchive', 'Failed to archive tasks')),
    ),

  batchDelete: taskProcedureWrite
    .input(idsInput)
    .mutation(({ ctx, input }) =>
      batchService(ctx).delete(input.ids).catch(rethrow('batchDelete', 'Failed to delete tasks')),
    ),

  /** Undo of a batch delete: bring the tasks back out of the recycle bin. */
  batchRestoreDeleted: taskProcedureWrite
    .input(idsInput)
    .mutation(({ ctx, input }) =>
      revertService(ctx)
        .restoreDeleted(input.ids)
        .catch(rethrow('batchRestoreDeleted', 'Failed to restore tasks')),
    ),

  /**
   * Undo of a batch status / field / archive change: put back each task's
   * `before`, only while it still holds `after` (a later edit wins — reported
   * as `skipped: conflict`). Takes the `reverts` the forward call returned.
   */
  batchRevert: taskProcedureWrite
    .input(
      z.object({
        reverts: z
          .array(
            z.object({
              after: revertValues,
              before: revertValues,
              id: z.string().trim().min(1),
            }),
          )
          .min(1)
          .max(TASK_BATCH_MAX_IDS),
      }),
    )
    .mutation(({ ctx, input }) =>
      revertService(ctx)
        // A person undid their own batch; recorded as their change.
        .revert(input.reverts, { agentId: ctx.actingAgentId ?? null, userId: ctx.userId })
        .catch(rethrow('batchRevert', 'Failed to undo the batch')),
    ),

  batchUpdate: taskProcedureWrite
    .input(
      idsInput.extend({
        assigneeAgentId: z.string().nullish(),
        assigneeUserId: z.string().nullish(),
        priority: z.number().int().min(0).max(4).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ids, ...patch } = input;
      const { result, tasks } = await batchService(ctx)
        // A person made the change; batch actions are user-only (no agent tool).
        .updateFields(ids, patch, { agentId: ctx.actingAgentId ?? null, userId: ctx.userId })
        .catch(rethrow('batchUpdate', 'Failed to update tasks'));
      return { ...result, tasks: tasks.map(toChangedRow) };
    }),

  batchUpdateStatus: taskProcedureWrite
    .input(idsInput.extend({ status: z.enum(TASK_BATCH_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      const { result, tasks } = await batchService(ctx)
        .updateStatus(input.ids, input.status, {
          agentId: ctx.actingAgentId ?? null,
          userId: ctx.userId,
        })
        .catch(rethrow('batchUpdateStatus', 'Failed to update task status'));
      return { ...result, tasks: tasks.map(toChangedRow) };
    }),
});
