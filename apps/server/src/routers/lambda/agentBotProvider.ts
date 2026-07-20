import { LineApiClient } from '@lobechat/chat-adapter-line';
import { fetchQrCode, pollQrStatus } from '@lobechat/chat-adapter-wechat';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  assertBotFeatureAccess,
  withBotPlatformAccessMeta,
} from '@/business/server/bot/featureAccess';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  assertBotAccessSettings,
  assertWatchKeywordsWritable,
  invalidateBotAfterUpdate,
  mergeBotSettingsForPersist,
} from '@/server/services/bot/agentBotProviderSettings';
import { getBotMessageRouter } from '@/server/services/bot/BotMessageRouter';
import { mergeWithDefaults, platformRegistry } from '@/server/services/bot/platforms';
import { GatewayService } from '@/server/services/gateway';
import { getBotRuntimeStatus } from '@/server/services/gateway/runtimeStatus';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const agentBotProviderProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  return opts.next({
    ctx: {
      agentBotProviderModel: new AgentBotProviderModel(ctx.serverDB, ctx.userId, gateKeeper, wsId),
    },
  });
});

// Write variant gates viewers out of bot-provider mutations
// (create/update/delete + start/test connections). Reads keep the bare proc.
const agentBotProviderProcedureWrite = agentBotProviderProcedure.use(
  withScopedPermission('agent:update'),
);

/**
 * Wrap the shared access-policy validator so violations surface as
 * `TRPCError(BAD_REQUEST)` — keeps client forms able to highlight the
 * failing field via the existing TRPC error path.
 */
function assertAccessSettingsForTRPC(settings: Record<string, unknown> | undefined): void {
  try {
    assertBotAccessSettings(settings);
  } catch (e) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: (e as Error).message,
    });
  }
}

export const agentBotProviderRouter = router({
  listPlatforms: authedProcedure.query(async ({ ctx }) => {
    return Promise.all(
      platformRegistry.listSerializedPlatforms().map((platform) =>
        withBotPlatformAccessMeta(platform, {
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        }),
      ),
    );
  }),

  create: agentBotProviderProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        applicationId: z.string(),
        credentials: z.record(z.string(), z.string()),
        enabled: z.boolean().optional(),
        platform: z.string(),
        settings: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertBotFeatureAccess({
        action: 'manage',
        applicationId: input.applicationId,
        platform: input.platform,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      const payload = {
        ...input,
        settings: mergeBotSettingsForPersist(input.platform, input.settings),
      };
      assertAccessSettingsForTRPC(payload.settings);
      await assertWatchKeywordsWritable({
        applicationId: input.applicationId,
        platform: input.platform,
        settings: payload.settings,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      try {
        return await ctx.agentBotProviderModel.create(payload);
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

  delete: agentBotProviderProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Load record before delete to get platform + applicationId
      const existing = await ctx.agentBotProviderModel.findById(input.id);
      if (existing) assertWorkspaceRowManageable(ctx, existing.userId, 'bot provider');

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

  refreshRuntimeStatus: agentBotProviderProcedureWrite
    .input(z.object({ applicationId: z.string(), platform: z.string() }))
    .mutation(async ({ input }) => {
      const service = new GatewayService();
      return service.refreshBotRuntimeStatus(input.platform, input.applicationId);
    }),

  refreshRuntimeStatusesByAgent: agentBotProviderProcedureWrite
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input }) => {
      const service = new GatewayService();
      await service.refreshBotRuntimeStatusesByAgent(input.agentId);
      return { ok: true as const };
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

  connectBot: agentBotProviderProcedureWrite
    .input(z.object({ applicationId: z.string(), platform: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertBotFeatureAccess({
        action: 'manage',
        applicationId: input.applicationId,
        platform: input.platform,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      const service = new GatewayService();
      const status = await service.startClient(input.platform, input.applicationId, ctx.userId);

      return { status };
    }),

  testConnection: agentBotProviderProcedureWrite
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

      await assertBotFeatureAccess({
        action: 'manage',
        applicationId,
        platform,
        userId: provider.userId,
        workspaceId: provider.workspaceId ?? undefined,
      });

      // Validate credentials against the platform API
      const entry = platformRegistry.getPlatform(platform);
      if (!entry) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Unsupported platform: ${platform}` });
      }

      const settings = mergeWithDefaults(
        entry.schema,
        provider.settings as Record<string, unknown> | undefined,
      );
      const result = await entry.clientFactory.validateCredentials(
        provider.credentials,
        settings,
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

  /**
   * Resolve the bot's `userId` (destination user ID) from a channel access
   * token by calling LINE's `/v2/bot/info`. The LINE Developers Console UI
   * does not surface this value, so the operator either runs `curl` themselves
   * or lets the form pre-fill the field via this procedure.
   */
  lineFetchBotInfo: authedProcedure
    .input(z.object({ channelAccessToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const api = new LineApiClient({ accessToken: input.channelAccessToken });
      try {
        const info = await api.getBotInfo();
        if (!info.userId) {
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message: 'LINE /v2/bot/info returned no userId',
          });
        }
        return {
          basicId: info.basicId,
          displayName: info.displayName,
          userId: info.userId,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to fetch bot info from LINE',
        });
      }
    }),

  wechatGetQrCode: authedProcedure.mutation(async ({ ctx }) => {
    await assertBotFeatureAccess({
      action: 'manage',
      platform: 'wechat',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId ?? undefined,
    });
    return fetchQrCode();
  }),

  wechatPollQrStatus: authedProcedure
    .input(z.object({ qrcode: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBotFeatureAccess({
        action: 'manage',
        platform: 'wechat',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      return pollQrStatus(input.qrcode);
    }),

  update: agentBotProviderProcedureWrite
    .input(
      z.object({
        applicationId: z.string().optional(),
        credentials: z.record(z.string(), z.string()).optional(),
        enabled: z.boolean().optional(),
        id: z.string(),
        platform: z.string().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...value } = input;

      // Load existing record to get platform + applicationId for cache invalidation
      const existing = await ctx.agentBotProviderModel.findById(id);
      if (existing) assertWorkspaceRowManageable(ctx, existing.userId, 'bot provider');
      const targetPlatform = value.platform ?? existing?.platform;
      const targetApplicationId = value.applicationId ?? existing?.applicationId;
      const isDisableOnly =
        value.enabled === false &&
        value.applicationId === undefined &&
        value.credentials === undefined &&
        value.platform === undefined &&
        value.settings === undefined;

      if (targetPlatform && !isDisableOnly) {
        await assertBotFeatureAccess({
          action: 'manage',
          applicationId: targetApplicationId,
          platform: targetPlatform,
          userId: ctx.userId,
          workspaceId: existing?.workspaceId ?? ctx.workspaceId ?? undefined,
        });
      }

      if (value.settings !== undefined) {
        value.settings = mergeBotSettingsForPersist(
          value.platform ?? existing?.platform,
          value.settings,
        );
        assertAccessSettingsForTRPC(value.settings);
        if (targetPlatform) {
          await assertWatchKeywordsWritable({
            applicationId: targetApplicationId,
            existingSettings: existing?.settings,
            platform: targetPlatform,
            settings: value.settings,
            userId: ctx.userId,
            workspaceId: existing?.workspaceId ?? ctx.workspaceId ?? undefined,
          });
        }
      }

      const result = await ctx.agentBotProviderModel.update(id, value);

      if (existing) {
        await invalidateBotAfterUpdate(
          {
            applicationId: existing.applicationId,
            platform: existing.platform,
            settings: existing.settings,
            userId: ctx.userId,
          },
          value,
        );
      }

      return result;
    }),
});
