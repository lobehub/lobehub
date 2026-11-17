import { resolveOwnedWorktrees } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { type WorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DeviceModel } from '@/database/models/device';
import type { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { WorktreeCleanupService } from '@/server/services/worktreeCleanup';
import { issueWorktreeReceipt } from '@/server/services/worktreeCleanup/receipt';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { assertCanUseTopicTargets } from '../_helpers/conversationResourceGuard';
import { assertCreatorTopicTargets } from '../_helpers/shareVisitorTargetGuard';
import { assertDeviceOperable } from '../device/guards';
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
  unpushedSubmodules: z.number().int().nonnegative().optional(),
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

interface OwnedWorktreeCtx {
  serverDB: LobeChatDatabase;
  topicModel: TopicModel;
  userId: string;
  workspaceId?: string | null;
  workspaceRole?: WorkspaceRole;
}

/** The topic row (recycle bin included) and its record for `path`. */
const loadOwnedWorktree = async (ctx: OwnedWorktreeCtx, topicId: string, path: string) => {
  const [row] = await ctx.topicModel.findOwnedWorktreeTopics([topicId]);
  const entry = resolveOwnedWorktrees(row?.metadata).find((item) => item.path === path);
  if (!row || !entry) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown worktree.' });
  return { entry, row };
};

/**
 * The device a worktree lives on must be one the caller may operate: the
 * service dispatches to it directly, past `deviceProcedure`'s own guard.
 */
const assertWorktreeDevice = async (ctx: OwnedWorktreeCtx, deviceId: string | undefined) => {
  if (!deviceId) return;
  const workspaceId = ctx.workspaceId ?? undefined;
  await assertDeviceOperable(
    {
      deviceModel: new DeviceModel(ctx.serverDB, ctx.userId, workspaceId),
      userId: ctx.userId,
      workspaceId,
      workspaceRole: ctx.workspaceRole,
    },
    deviceId,
    'remove or restore a worktree',
  );
};

/**
 * Running cleanups over IPC is the job of the machine itself: in a workspace,
 * only its enrolling member's desktop claims a device's jobs.
 */
const assertOwnDevice = async (ctx: OwnedWorktreeCtx, deviceId: string | undefined) => {
  if (!deviceId || !ctx.workspaceId) return;
  const device = await new DeviceModel(
    ctx.serverDB,
    ctx.userId,
    ctx.workspaceId,
  ).findWorkspaceDeviceById(deviceId);
  if (device?.userId !== ctx.userId)
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the machine itself runs its worktree cleanups.',
    });
};

/** Destructive or settling actions belong to the topic's creator (or a workspace owner). */
const assertTopicCreator = (ctx: OwnedWorktreeCtx, topicUserId: string) =>
  assertWorkspaceRowManageable(ctx, topicUserId, 'topic');

export const ownedWorktreeRouter = router({
  /**
   * A creation receipt for the worktree the composer is about to create for a
   * new topic: signed over the caller's user id, so only that user's topics
   * can later present it to the device. `null` when the server has no secret
   * to sign with (the worktree then has no receipt: never discarded by force).
   */
  issueWorktreeReceipt: ownedWorktreeProcedure.mutation(
    async ({ ctx }) => issueWorktreeReceipt(ctx.userId) ?? null,
  ),

  /**
   * Discard a kept worktree's changes and delete it — the topic creator's
   * call, on a device they may operate. `local`: the desktop runs it over IPC,
   * so only the claim is taken here and the result arrives with
   * `reportOwnedWorktreeCleanup`.
   */
  discardOwnedWorktree: ownedWorktreeProcedure
    .input(target.extend({ local: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertTopic(ctx, input.topicId);
      const { entry, row } = await loadOwnedWorktree(ctx, input.topicId, input.path);
      assertTopicCreator(ctx, row.userId);
      await assertWorktreeDevice(ctx, entry.deviceId);
      return (
        (await ctx.worktreeCleanup.discard(input.topicId, input.path, { local: input.local })) ??
        null
      );
    }),

  keepOwnedWorktree: ownedWorktreeProcedure.input(target).mutation(async ({ ctx, input }) => {
    await assertTopic(ctx, input.topicId);
    const { row } = await loadOwnedWorktree(ctx, input.topicId, input.path);
    assertTopicCreator(ctx, row.userId);
    return (await ctx.worktreeCleanup.keep(input.topicId, input.path)) ?? null;
  }),

  /**
   * The desktop takes the cleanups that wait on it (its own device id with the
   * gateway off, or records without a device) to run over IPC.
   */
  claimLocalWorktreeCleanups: ownedWorktreeProcedure
    .input(z.object({ deviceId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnDevice(ctx, input.deviceId);
      return ctx.worktreeCleanup.claimLocalCleanups(input.deviceId, {
        canClaim: async (row) => {
          try {
            await assertTopic(ctx, row.id);
            return true;
          } catch {
            return false;
          }
        },
      });
    }),

  /**
   * A desktop's IPC result. Accepted from the topic's creator, or from whoever
   * operates the device the worktree is on (a shared workspace device runs its
   * teammates' cleanups).
   */
  reportOwnedWorktreeCleanup: ownedWorktreeProcedure
    .input(
      target.extend({
        result: cleanupResultSchema,
        trigger: z.enum(['archived', 'discarded', 'trashed']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { entry, row } = await loadOwnedWorktree(ctx, input.topicId, input.path);
      if (entry.deviceId) await assertWorktreeDevice(ctx, entry.deviceId);
      else assertTopicCreator(ctx, row.userId);
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
   * Check a cleaned-up worktree out again before a restored topic's next turn
   * (any member who may use the topic and operate its device). Runs on the
   * device unless the desktop runs it (`local`) and reports its `result`.
   */
  restoreOwnedWorktree: ownedWorktreeProcedure
    .input(
      target.extend({
        /** The worktree is on the calling desktop: answer `needsLocal` instead of the RPC. */
        local: z.boolean().optional(),
        result: restoreResultSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTopic(ctx, input.topicId);
      const { entry } = await loadOwnedWorktree(ctx, input.topicId, input.path);
      await assertWorktreeDevice(ctx, entry.deviceId);
      return ctx.worktreeCleanup.restore(input.topicId, input.path, {
        local: input.local,
        result: input.result,
      });
    }),
});
