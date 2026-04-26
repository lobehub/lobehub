import { type TaskTemplateSkillSource } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { klavisEnv } from '@/config/klavis';
import { UserTaskTemplateInteractionModel } from '@/database/models/userTaskTemplateInteraction';
import { appEnv } from '@/envs/app';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { TaskTemplateService } from '@/server/services/taskTemplate';

// Env-derived flags are static at startup, so compute once at module init.
const ENABLED_SKILL_SOURCES: ReadonlySet<TaskTemplateSkillSource> = (() => {
  const sources = new Set<TaskTemplateSkillSource>();
  if (klavisEnv.KLAVIS_API_KEY) sources.add('klavis');
  if (appEnv.MARKET_TRUSTED_CLIENT_ID && appEnv.MARKET_TRUSTED_CLIENT_SECRET) {
    sources.add('lobehub');
  }
  return sources;
})();

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
        const data = await service.listDailyRecommend(input.interestKeys, {
          enabledSkillSources: ENABLED_SKILL_SOURCES,
          excludeIds,
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
});
