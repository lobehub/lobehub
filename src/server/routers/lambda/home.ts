import { after } from 'next/server';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { AgentMigrationRepo } from '@/database/repositories/agentMigration';
import { HomeRepository } from '@/database/repositories/home';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const homeProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentMigrationRepo: new AgentMigrationRepo(ctx.serverDB, ctx.userId),
      agentModel: new AgentModel(ctx.serverDB, ctx.userId),
      homeRepository: new HomeRepository(ctx.serverDB, ctx.userId),
    },
  });
});

export const homeRouter = router({
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
