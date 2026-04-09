import { fetchQrCode, pollQrStatus } from '@lobechat/chat-adapter-wechat';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { getBotMessageRouter } from '@/server/services/bot/BotMessageRouter';
import { platformRegistry } from '@/server/services/bot/platforms';
import { GatewayService } from '@/server/services/gateway';
import { getBotRuntimeStatus } from '@/server/services/gateway/runtimeStatus';

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
  listPlatforms: authedProcedure.query(() => {
    return platformRegistry.listSerializedPlatforms();
  }),

  create: agentBotProviderProcedure
    .input(
      z.object({
        agentId: z.string(),
        applicationId: z.string(),
        credentials: z.record(z.string()),
        enabled: z.boolean().optional(),
        platform: z.string(),
        settings: z.record(z.unknown()).optional(),
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
      // Load record before delete to get platform + applicationId
      const existing = await ctx.agentBotProviderModel.findById(input.id);

      const result = await ctx.agentBotProviderModel.delete(input.id);

      // Stop running client and invalidate cached bot
      if (existing) {
        const service = new GatewayService();
        await service.stopClient(existing.platform, existing.applicationId, ctx.userId);
        await getBotMessageRouter().invalidateBot(existing.platform, existing.applicationId);
      }

      return result;
    }),

  getByAgentId: agentBotProviderProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const providers = await ctx.agentBotProviderModel.findByAgentId(input.agentId);

      const statuses = await Promise.all(
        providers.map((p) => getBotRuntimeStatus(p.platform, p.applicationId)),
      );

      return providers.map((p, i) => ({
        ...p,
        runtimeStatus: statuses[i].status,
      }));
    }),

  getRuntimeStatus: authedProcedure
    .input(z.object({ applicationId: z.string(), platform: z.string() }))
    .query(async ({ input }) => {
      return getBotRuntimeStatus(input.platform, input.applicationId);
    }),

  list: agentBotProviderProcedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          platform: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const providers = await ctx.agentBotProviderModel.query(input);

      const statuses = await Promise.all(
        providers.map((p) => getBotRuntimeStatus(p.platform, p.applicationId)),
      );

      return providers.map((p, i) => ({
        ...p,
        runtimeStatus: statuses[i].status,
      }));
    }),

  connectBot: agentBotProviderProcedure
    .input(z.object({ applicationId: z.string(), platform: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new GatewayService();
      const status = await service.startClient(input.platform, input.applicationId, ctx.userId);

      return { status };
    }),

  testConnection: agentBotProviderProcedure
    .input(z.object({ applicationId: z.string(), platform: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { platform, applicationId } = input;

      // Load provider from DB
      const provider = await ctx.agentBotProviderModel.findEnabledByApplicationId(
        platform,
        applicationId,
      );
      if (!provider) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No enabled bot found for ${platform}/${applicationId}`,
        });
      }

      // Validate credentials against the platform API
      const entry = platformRegistry.getPlatform(platform);
      if (!entry) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Unsupported platform: ${platform}` });
      }

      const result = await entry.clientFactory.validateCredentials(
        provider.credentials,
        (provider.settings as Record<string, unknown>) || {},
        applicationId,
        platform,
      );

      if (!result.valid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            result.errors?.map((e) => `${e.field}: ${e.message}`).join('; ') || 'Validation failed',
        });
      }

      return { valid: true };
    }),

  wechatGetQrCode: authedProcedure.mutation(async () => {
    return fetchQrCode();
  }),

  wechatPollQrStatus: authedProcedure
    .input(z.object({ qrcode: z.string() }))
    .query(async ({ input }) => {
      return pollQrStatus(input.qrcode);
    }),

  update: agentBotProviderProcedure
    .input(
      z.object({
        applicationId: z.string().optional(),
        credentials: z.record(z.string()).optional(),
        enabled: z.boolean().optional(),
        id: z.string(),
        platform: z.string().optional(),
        settings: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...value } = input;

      // Load existing record to get platform + applicationId for cache invalidation
      const existing = await ctx.agentBotProviderModel.findById(id);

      const result = await ctx.agentBotProviderModel.update(id, value);

      // Invalidate cached bot so it reloads with fresh config on next webhook
      if (existing) {
        const shouldStopRuntime =
          value.enabled === false ||
          (value.applicationId !== undefined && value.applicationId !== existing.applicationId) ||
          (value.platform !== undefined && value.platform !== existing.platform);

        if (shouldStopRuntime) {
          const service = new GatewayService();
          await service.stopClient(existing.platform, existing.applicationId, ctx.userId);
        }

        await getBotMessageRouter().invalidateBot(existing.platform, existing.applicationId);
      }

      return result;
    }),
});
