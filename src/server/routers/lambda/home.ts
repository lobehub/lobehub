import debug from 'debug';
import { after } from 'next/server';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { AgentMigrationRepo } from '@/database/repositories/agentMigration';
import { HomeRepository } from '@/database/repositories/home';
import { getRedisConfig } from '@/envs/redis';
import {
  initializeRedisWithPrefix,
  isRedisEnabled,
  RedisKeyNamespace,
  RedisKeys,
} from '@/libs/redis';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const log = debug('lobe-server:home-router');

interface HomeBriefPair {
  hint: string;
  welcome: string;
}

interface HomeBriefData {
  pairs: HomeBriefPair[];
}

const readHomeBriefFromRedis = async (userId: string): Promise<HomeBriefData | null> => {
  try {
    const redisConfig = getRedisConfig();
    if (!isRedisEnabled(redisConfig)) return null;

    const redis = await initializeRedisWithPrefix(redisConfig, RedisKeyNamespace.AI_GENERATION);
    if (!redis) return null;

    const key = RedisKeys.aiGeneration.homeBrief(userId);
    const value = await redis.get(key);
    if (!value) return null;

    const parsed = JSON.parse(value) as HomeBriefData;
    if (!Array.isArray(parsed.pairs)) return null;
    return parsed;
  } catch (error) {
    log('Failed to read home brief from Redis for user %s: %O', userId, error);
    return null;
  }
};

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
  getDailyBrief: homeProcedure.query(async ({ ctx }): Promise<HomeBriefData> => {
    const data = await readHomeBriefFromRedis(ctx.userId);
    return data ?? { pairs: [] };
  }),

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
