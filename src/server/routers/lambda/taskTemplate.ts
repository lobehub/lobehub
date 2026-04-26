import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { UserTaskTemplateInteractionModel } from '@/database/models/userTaskTemplateInteraction';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { TaskTemplateService } from '@/server/services/taskTemplate';

const taskTemplateProcedure = authedProcedure.use(serverDatabase);

const listDailyRecommendSchema = z.object({
  interestKeys: z.array(z.string().max(64)).max(32),
});

const dismissSchema = z.object({
  templateId: z.string().max(64),
});

export const taskTemplateRouter = router({
  dismiss: taskTemplateProcedure.input(dismissSchema).mutation(async ({ input, ctx }) => {
    const { userId, serverDB: db } = ctx;
    await new UserTaskTemplateInteractionModel(db, userId).dismiss(input.templateId);
    return { success: true };
  }),

  listDailyRecommend: taskTemplateProcedure
    .input(listDailyRecommendSchema)
    .query(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      try {
        const excludeIds = await new UserTaskTemplateInteractionModel(
          db,
          userId,
        ).listExcludedTemplateIds();
        const service = new TaskTemplateService(userId);
        const data = await service.listDailyRecommend(input.interestKeys, { excludeIds });
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
});
