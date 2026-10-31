import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { assertCanManageTopicShare } from './guards';
import { topicShareProcedure } from './procedures';

export const topicShareRouter = router({
  get: topicShareProcedure
    .input(z.object({ topicId: z.string() }))
    .query(({ ctx, input }) => ctx.topicShareModel.findByTopic(input.topicId)),
  update: topicShareProcedure
    .input(z.object({ topicId: z.string(), visibility: z.enum(['private', 'link']) }))
    .mutation(async ({ ctx, input }) => {
      // alint-expect
      await assertCanManageTopicShare(ctx, input.topicId);
      return ctx.topicShareModel.setVisibility(input.topicId, input.visibility);
    }),
  revoke: topicShareProcedure
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageTopicShare(ctx, input.topicId);
      return ctx.topicShareModel.revoke(input.topicId);
    }),
});
