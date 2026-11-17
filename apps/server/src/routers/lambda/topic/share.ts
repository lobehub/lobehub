import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { router } from '@/libs/trpc/lambda';

import { assertCanManageTopicShare, recordTopicShareAudit } from '../_helpers/topicShareGuard';
import { topicProcedure } from './procedures';

export const shareRouter = router({
  /**
   * Disable sharing for a topic (deletes share record)
   */
  disableSharing: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertCanManageTopicShare(ctx, input.topicId);

      const previous = await ctx.topicShareModel.getByTopicId(input.topicId);
      const result = await ctx.topicShareModel.deleteByTopicId(input.topicId);

      if (previous) {
        await recordTopicShareAudit(ctx, {
          currentVisibility: 'private',
          previousVisibility: previous.visibility,
          topicId: input.topicId,
        });
      }

      return result;
    }),
  /**
   * Enable sharing for a topic (creates share record)
   */
  enableSharing: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        topicId: z.string(),
        visibility: z.enum(['private', 'link']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanManageTopicShare(ctx, input.topicId, input.visibility);

      const previous = await ctx.topicShareModel.getByTopicId(input.topicId);
      const result = await ctx.topicShareModel.create(input.topicId, input.visibility);

      if (result) {
        await recordTopicShareAudit(ctx, {
          currentVisibility: result.visibility,
          previousVisibility: previous?.visibility ?? 'private',
          topicId: input.topicId,
        });
      }

      return result;
    }),
  getShareInfo: topicProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.topicShareModel.getByTopicId(input.topicId);
    }),
  /**
   * Update share visibility
   */
  updateShareVisibility: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        topicId: z.string(),
        visibility: z.enum(['private', 'link']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanManageTopicShare(ctx, input.topicId, input.visibility);

      const previous = await ctx.topicShareModel.getByTopicId(input.topicId);
      const result = await ctx.topicShareModel.updateVisibility(input.topicId, input.visibility);

      if (result && previous) {
        await recordTopicShareAudit(ctx, {
          currentVisibility: result.visibility,
          previousVisibility: previous.visibility,
          topicId: input.topicId,
        });
      }

      return result;
    }),
});
