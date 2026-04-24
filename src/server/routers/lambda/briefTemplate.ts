import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { BriefTemplateService } from '@/server/services/briefTemplate';

const briefTemplateProcedure = authedProcedure.use(serverDatabase);

const listDailyRecommendSchema = z.object({
  interestKeys: z.array(z.string().max(64)).max(32),
});

const createFromTemplateSchema = z.object({
  prompt: z.string().min(1).max(4000),
  templateId: z.string().min(1),
  title: z.string().min(1).max(200),
});

export const briefTemplateRouter = router({
  listDailyRecommend: briefTemplateProcedure
    .input(listDailyRecommendSchema)
    .query(async ({ input, ctx }) => {
      try {
        const service = new BriefTemplateService(ctx.serverDB, ctx.userId);
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

  createFromTemplate: briefTemplateProcedure
    .input(createFromTemplateSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const service = new BriefTemplateService(ctx.serverDB, ctx.userId);
        const result = await service.createFromTemplate(input);
        return { ...result, success: true };
      } catch (error) {
        console.error('[briefTemplate:createFromTemplate]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create cron job from brief template',
        });
      }
    }),
});
