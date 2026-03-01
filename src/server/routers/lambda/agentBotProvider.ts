import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { GatewayService } from '@/server/services/gateway';

const agentBotProviderProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  return opts.next({
    ctx: {
      agentBotProviderModel: new AgentBotProviderModel(ctx.serverDB, ctx.userId, gateKeeper),
    },
  });
});

export const agentBotProviderRouter = router({
  create: agentBotProviderProcedure
    .input(
      z.object({
        agentId: z.string(),
        applicationId: z.string(),
        credentials: z.record(z.string()),
        enabled: z.boolean().optional(),
        platform: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await ctx.agentBotProviderModel.create(input);
      } catch (e: any) {
        if (e?.cause?.code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `A bot with application ID "${input.applicationId}" is already registered on ${input.platform}. Each application ID can only be used once.`,
          });
        }
        throw e;
      }
    }),

  delete: agentBotProviderProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.agentBotProviderModel.delete(input.id);
    }),

  getByAgentId: agentBotProviderProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.agentBotProviderModel.findByAgentId(input.agentId);
    }),

  connectBot: agentBotProviderProcedure
    .input(z.object({ applicationId: z.string(), platform: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new GatewayService();
      const status = await service.startBot(input.platform, input.applicationId, ctx.userId);

      return { status };
    }),

  update: agentBotProviderProcedure
    .input(
      z.object({
        applicationId: z.string().optional(),
        credentials: z.record(z.string()).optional(),
        enabled: z.boolean().optional(),
        id: z.string(),
        platform: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...value } = input;
      return ctx.agentBotProviderModel.update(id, value);
    }),
});
