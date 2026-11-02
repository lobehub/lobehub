import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { TaskBatchService } from '@/server/services/task/batch';
import { TASK_BATCH_MAX_IDS, TASK_BATCH_STATUSES } from '@/server/services/task/batchLimits';

import { taskProcedureWrite } from './procedures';

const idsInput = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(TASK_BATCH_MAX_IDS),
});

const batchService = (ctx: {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}) => new TaskBatchService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);

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
      const { result } = await batchService(ctx)
        // A person made the change; batch actions are user-only (no agent tool).
        .updateFields(ids, patch, { agentId: ctx.actingAgentId ?? null, userId: ctx.userId })
        .catch(rethrow('batchUpdate', 'Failed to update tasks'));
      return result;
    }),

  batchUpdateStatus: taskProcedureWrite
    .input(idsInput.extend({ status: z.enum(TASK_BATCH_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      const { result } = await batchService(ctx)
        .updateStatus(input.ids, input.status, {
          agentId: ctx.actingAgentId ?? null,
          userId: ctx.userId,
        })
        .catch(rethrow('batchUpdateStatus', 'Failed to update task status'));
      return result;
    }),
});
