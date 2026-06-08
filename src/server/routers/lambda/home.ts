import { after } from 'next/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { AgentMigrationRepo } from '@/database/repositories/agentMigration';
import { HomeRepository } from '@/database/repositories/home';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type HomeBriefData, HomeService } from '@/server/services/home';

const homeProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentMigrationRepo: new AgentMigrationRepo(ctx.serverDB, ctx.userId, workspaceId),
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, workspaceId),
      homeRepository: new HomeRepository(ctx.serverDB, ctx.userId, workspaceId),
      homeService: new HomeService(ctx.userId),
    },
  });
});

export const homeRouter = router({
  getDailyBrief: homeProcedure.query(
    ({ ctx }): Promise<HomeBriefData> => ctx.homeService.getDailyBrief(),
  ),

  getSidebarAgentList: homeProcedure.query(async ({ ctx }) => {
    const result = await ctx.homeRepository.getSidebarAgentList();

    // Runtime migration: backfill sessionGroupId for legacy agents
    const runMigration = async () => {
      try {
        await ctx.agentMigrationRepo.migrateSessionGroupId();
      } catch (error) {
        console.error('[AgentMigration] Failed to migrate sessionGroupId:', error);
      }
    };

    // Use Next.js after() for non-blocking execution
    after(runMigration);

    return result;
  }),

  searchAgents: homeProcedure
    .input(z.object({ keyword: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.homeRepository.searchAgents(input.keyword);
    }),

  updateAgentSessionGroupId: homeProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        sessionGroupId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.updateSessionGroupId(input.agentId, input.sessionGroupId);
    }),
});

export type HomeRouter = typeof homeRouter;
