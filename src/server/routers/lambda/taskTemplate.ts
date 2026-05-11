import { KNOWN_TASK_TEMPLATE_IDS } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import {
  ENABLED_SKILL_SOURCES,
  RECOMMEND_COUNT_MAX,
  TaskTemplateService,
} from '@/server/services/taskTemplate';

const listDailyRecommendSchema = z.object({
  count: z.number().int().min(1).max(RECOMMEND_COUNT_MAX).optional(),
  interestKeys: z.array(z.string().max(64)).max(32),
  refreshSeed: z.string().min(1).max(32).optional(),
});

const templateIdSchema = z.object({
  templateId: z
    .string()
    .max(64)
    .refine((id) => KNOWN_TASK_TEMPLATE_IDS.has(id), { message: 'Unknown task template id' }),
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
          enabledSkillSources: ENABLED_SKILL_SOURCES,
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
