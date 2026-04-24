import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { BriefTemplateService } from '@/server/services/briefTemplate';

const listDailyRecommendSchema = z.object({
  interestKeys: z.array(z.string().max(64)).max(32),
});

export const briefTemplateRouter = router({
  listDailyRecommend: authedProcedure
    .input(listDailyRecommendSchema)
    .query(async ({ input, ctx }) => {
      try {
        const service = new BriefTemplateService(ctx.userId);
        const data = await service.listDailyRecommend(input.interestKeys);
        return { data, success: true };
      } catch (error) {
        console.error('[briefTemplate:listDailyRecommend]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list recommended brief templates',
        });
      }
    }),
});
