import { GOAL_GRAPH_CAPABILITY } from '@lobechat/const/goal';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { GoalShareModel } from '@/database/models/goalShare';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GoalService } from '@/server/services/goal';
import { graphForClient } from '@/server/services/goal/graphCompat';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';
import { readSharedGoalAcceptances } from './_helpers/sharedGoalAcceptances';
import { buildSharedGoalView } from './_helpers/sharedGoalView';
import { goalProcedure, mapGoalError } from './goalProcedures';

const visibilitySchema = z.enum(['private', 'link']);
const goalIdInput = z.object({ goalId: z.string().trim().min(1) });

/**
 * The goal the caller may manage a share for: its creator, or a workspace
 * owner. A goal the caller cannot see at all reads as NOT_FOUND.
 */
const requireManageableGoal = async (
  ctx: {
    goalModel: { findById: (id: string) => Promise<{ userId: string } | undefined> };
    userId: string;
    workspaceId?: string | null;
    workspaceRole?: string;
  },
  goalId: string,
) => {
  const goal = await ctx.goalModel.findById(goalId);
  if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  assertWorkspaceRowManageable(ctx, goal.userId, 'goal share');
  return goal;
};

const goalShareProcedure = goalProcedure.use(async (opts) =>
  opts.next({
    ctx: {
      goalShareModel: new GoalShareModel(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
    },
  }),
);

export const goalShareRouter = router({
  /** Remove the share link (deletes the share record). */
  disable: goalShareProcedure
    .use(withScopedPermission('agent:update'))
    .input(goalIdInput)
    .mutation(async ({ ctx, input }) => {
      try {
        await requireManageableGoal(ctx, input.goalId);
        await ctx.goalShareModel.deleteByGoalId(input.goalId);
        return { success: true };
      } catch (error) {
        mapGoalError(error, 'disable share for');
      }
    }),

  /**
   * Create (or reuse) the share of a finished goal. A goal with no wrap-up
   * report has nothing to show a visitor, so it is refused rather than
   * publishing an empty page.
   */
  enable: goalShareProcedure
    .use(withScopedPermission('agent:update'))
    .input(goalIdInput.extend({ visibility: visibilitySchema.default('private') }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireManageableGoal(ctx, input.goalId);

        const { report } = await ctx.goalService.graph(input.goalId);
        if (!report?.latest) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This goal has no wrap-up report yet — there is nothing finished to share',
          });
        }

        const created = await ctx.goalShareModel.create(input.goalId, input.visibility);
        // `create` keeps an existing record as is; an explicit visibility on a
        // re-enable still has to win.
        const share =
          created && created.visibility !== input.visibility
            ? await ctx.goalShareModel.updateVisibility(input.goalId, input.visibility)
            : created;
        return { data: share, success: true };
      } catch (error) {
        mapGoalError(error, 'enable share for');
      }
    }),

  /** The share record of a goal, or null when it is not shared. */
  getInfo: goalShareProcedure.input(goalIdInput).query(async ({ ctx, input }) => {
    try {
      await requireManageableGoal(ctx, input.goalId);
      return { data: await ctx.goalShareModel.getByGoalId(input.goalId), success: true };
    } catch (error) {
      mapGoalError(error, 'read share for');
    }
  }),

  /**
   * The redacted public view of a shared goal. Anyone with the link reads a
   * `link` share; a `private` one is the owner's alone. The read runs as the
   * share owner, never as the visitor.
   */
  getSharedGoal: publicProcedure
    .use(serverDatabase)
    .input(
      z.object({
        /** Graph features the viewer renders (see `GOAL_GRAPH_CAPABILITY`). */
        capabilities: z.array(z.string()).max(20).optional(),
        shareId: z.string().trim().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const share = await GoalShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        input.shareId,
        ctx.userId ?? undefined,
      );
      const owner = { userId: share.ownerId, workspaceId: share.workspaceId ?? undefined };
      const isOwner = !!ctx.userId && share.ownerId === ctx.userId;

      try {
        const graph = graphForClient(
          await new GoalService(ctx.serverDB, owner.userId, owner.workspaceId).graph(share.goalId),
          input.capabilities ?? [GOAL_GRAPH_CAPABILITY.batch],
        );
        const { acceptances, nodeAcceptanceIds } = await readSharedGoalAcceptances(
          ctx.serverDB,
          owner,
          graph.acceptances,
        );

        if (!isOwner) {
          // A counter must never break the page it counts.
          await GoalShareModel.incrementViewCount(ctx.serverDB, share.shareId).catch(() => {});
        }

        return {
          data: {
            ...buildSharedGoalView(graph, acceptances, nodeAcceptanceIds),
            isOwner,
            visibility: share.visibility,
          },
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'read shared');
      }
    }),

  /** Change who can open the link. */
  setVisibility: goalShareProcedure
    .use(withScopedPermission('agent:update'))
    .input(goalIdInput.extend({ visibility: visibilitySchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireManageableGoal(ctx, input.goalId);
        const share = await ctx.goalShareModel.updateVisibility(input.goalId, input.visibility);
        if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'This goal is not shared' });
        return { data: share, success: true };
      } catch (error) {
        mapGoalError(error, 'update share for');
      }
    }),
});
