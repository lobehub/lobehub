import { TASK_TEMPLATE_RECOMMEND_MAX_COUNT } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { TaskTemplateService } from '@/server/services/taskTemplate';

const listDailyRecommendSchema = z.object({
  count: z.number().int().min(1).max(TASK_TEMPLATE_RECOMMEND_MAX_COUNT).optional(),
  interestKeys: z.array(z.string().max(64)).max(32),
  locale: z.string().max(32).optional(),
  refreshSeed: z.string().min(1).max(32).optional(),
});

const templateIdSchema = z.object({
  templateId: z.number().int().positive(),
});

export const taskTemplateRouter = router({
  dismiss: authedProcedure.input(templateIdSchema).mutation(async () => ({ success: true })),

  listDailyRecommend: authedProcedure
    .input(listDailyRecommendSchema)
    .query(async ({ input, ctx }) => {
      try {
        const service = new TaskTemplateService(ctx.userId);
        const data = await service.listDailyRecommend(input.interestKeys, {
          count: input.count,
          locale: input.locale,
          refreshSeed: input.refreshSeed,
        });
        return { data, success: true };
      } catch (error) {
        console.error('[taskTemplate:listDailyRecommend]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list recommended task templates',
        });
      }
    }),

  recordCreated: authedProcedure.input(templateIdSchema).mutation(async () => ({ success: true })),
});
