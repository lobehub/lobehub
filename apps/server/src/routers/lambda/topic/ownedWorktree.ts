import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { router } from '@/libs/trpc/lambda';
import { WorktreeCleanupService } from '@/server/services/worktreeCleanup';

import { assertCanUseTopicTargets } from '../_helpers/conversationResourceGuard';
import { assertCreatorTopicTargets } from '../_helpers/shareVisitorTargetGuard';
import { guardCtx, topicProcedure } from './procedures';

/**
 * The worktrees the app created for a topic (`metadata.ownedWorktrees`): the
 * user's "Discard changes and delete" / "Keep" on a kept one, bringing one
 * back for a restored topic, and the desktop's own IPC executions reporting
 * in. Archive and trash start the automatic cleanup themselves.
 */

const target = z.object({ path: z.string().min(1), topicId: z.string() });

const cleanupResultSchema = z.object({
  branch: z.string().optional(),
  dirtyFiles: z.number().int().nonnegative().optional(),
  error: z.string().max(2000).optional(),
  outcome: z.enum(['dirty', 'error', 'locked', 'refused', 'removed']),
});

const restoreResultSchema = z.object({
  error: z.string().max(2000).optional(),
  outcome: z.enum(['branchMissing', 'error', 'refused', 'restored']),
});

const ownedWorktreeProcedure = topicProcedure
  .use(withScopedPermission('topic:update'))
  .use(async (opts) => {
    const { ctx } = opts;
    return opts.next({
      ctx: {
        worktreeCleanup: new WorktreeCleanupService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ),
      },
    });
  });

const assertTopic = async (ctx: Parameters<typeof guardCtx>[0], topicId: string) => {
  await assertCanUseTopicTargets(guardCtx(ctx), [topicId]);
  await assertCreatorTopicTargets(guardCtx(ctx), [topicId]);
};

export const ownedWorktreeRouter = router({
  /**
   * Discard a kept worktree's changes and delete it. `local`: the desktop
   * runs it over IPC, so only the claim is taken here and the result arrives
   * with `reportOwnedWorktreeCleanup`.
   */
  discardOwnedWorktree: ownedWorktreeProcedure
    .input(target.extend({ local: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertTopic(ctx, input.topicId);
      return (
        (await ctx.worktreeCleanup.discard(input.topicId, input.path, { local: input.local })) ??
        null
      );
    }),

  keepOwnedWorktree: ownedWorktreeProcedure.input(target).mutation(async ({ ctx, input }) => {
    await assertTopic(ctx, input.topicId);
    return (await ctx.worktreeCleanup.keep(input.topicId, input.path)) ?? null;
  }),

  /**
   * The desktop takes the cleanups that wait on it (its own device id with the
   * gateway off, or records without a device) to run over IPC.
   */
  claimLocalWorktreeCleanups: ownedWorktreeProcedure
    .input(z.object({ deviceId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => ctx.worktreeCleanup.claimLocalCleanups(input.deviceId)),

  reportOwnedWorktreeCleanup: ownedWorktreeProcedure
    .input(
      target.extend({
        result: cleanupResultSchema,
        trigger: z.enum(['archived', 'discarded', 'trashed']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTopic(ctx, input.topicId);
      return (
        (await ctx.worktreeCleanup.recordCleanupResult(
          input.topicId,
          input.path,
          input.trigger,
          input.result,
        )) ?? null
      );
    }),

  /**
   * Check a cleaned-up worktree out again before a restored topic's next turn.
   * Runs on the device unless the desktop already did it and passes `result`.
   */
  restoreOwnedWorktree: ownedWorktreeProcedure
    .input(target.extend({ result: restoreResultSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertTopic(ctx, input.topicId);
      return ctx.worktreeCleanup.restore(input.topicId, input.path, input.result);
    }),
});
