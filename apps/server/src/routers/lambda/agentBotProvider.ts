import { LarkApiClient } from '@lobechat/chat-adapter-feishu';
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
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';
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
import {
  containsMaskedCredential,
  maskCredentials,
  resolveMaskedCredentials,
} from '@/server/services/bot/credentialMasking';
import {
  type BotProviderFieldValues,
  collectFieldFormatViolations,
  formatFieldFormatViolations,
  mergeWithDefaults,
  platformRegistry,
  withResolvedConcurrencySettings,
} from '@/server/services/bot/platforms';
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

const BOT_NOT_FOUND_MESSAGE = 'Bot integration not found';

/**
 * Gate the cross-scope reclaim on the workspace the binding actually lives in.
 *
 * The procedure's `agent:update` scope is evaluated against the caller's active
 * workspace, which by definition is not the one holding a stranded row. Being
 * its original creator says nothing about present access, so re-check
 * membership where it counts: an active, non-viewer seat in the owning
 * workspace. A binding with no workspace is personal, and the creator check
 * already settled it.
 */
async function assertStrandedWorkspaceStillManageable(
  ctx: { serverDB: LobeChatDatabase; userId: string },
  workspaceId: string | null,
): Promise<void> {
  if (!workspaceId) return;

  const member = await new WorkspaceMemberModel(ctx.serverDB, ctx.userId).getMember(
    workspaceId,
    ctx.userId,
  );

  if (member && member.role !== 'viewer') return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: `This bot belongs to workspace ${workspaceId}, and you no longer have permission to manage it there. Ask a member of that workspace to remove the binding.`,
  });
}

/**
 * Turn a unique-index violation into something the caller can act on.
 *
 * `(platform, applicationId)` is unique across the whole deployment because it
 * is the webhook routing key, while `list` only ever shows the caller's active
 * scope. The old message asserted "already registered" without looking, so a
 * holder sitting in the caller's other scope — invisible to `list`, untouched
 * by `remove` — read as a phantom constraint with nothing behind it.
 *
 * Resolve the actual holder and say where it is. A binding the caller created
 * is theirs to know about in full; anyone else's is reported as taken without
 * naming the agent, the workspace or the owner.
 */
async function describeApplicationIdConflict(
  ctx: { serverDB: LobeChatDatabase; userId: string },
  platform: string,
  applicationId: string,
): Promise<string> {
  const head = `Application ID "${applicationId}" is already bound on ${platform}`;
  const holder = await AgentBotProviderModel.findByPlatformAndAppId(
    ctx.serverDB,
    platform,
    applicationId,
  );

  // Lost the race with a concurrent delete — the key is free again.
  if (!holder) return `${head}. Retry the request.`;

  if (holder.userId !== ctx.userId) {
    return `${head} by another account. An application ID can only be bound to one agent, so ask whoever set it up to remove their binding first.`;
  }

  const where = holder.workspaceId
    ? `workspace ${holder.workspaceId}`
    : 'your personal (non-workspace) scope';

  return `${head} to your agent ${holder.agentId} in ${where}. Remove that binding first: lh bot remove ${holder.id}. If it does not appear in \`lh bot list\`, you are listing a different scope — the binding is still there and still holds the ID.`;
}

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

/**
 * Reject credentials that can't possibly work before they reach the database.
 *
 * These fields attract the wrong value — an OAuth authorize URL in the
 * public-key box, an API key in place of a bot token — and the bot then fails
 * to connect with no obvious cause. The form enforces the same schema patterns
 * client-side; this stops anything that skips it.
 */
function assertFieldFormatsForTRPC(
  platform: string | undefined,
  values: BotProviderFieldValues,
): void {
  if (!platform) return;

  const entry = platformRegistry.getPlatform(platform);
  const violations = collectFieldFormatViolations(entry?.schema, values);
  if (violations.length === 0) return;

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `Invalid format for ${formatFieldFormatViolations(violations)}`,
  });
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
      // A new binding has no stored secret for a mask to stand in for, so this
      // can only be a form that submitted what it read back.
      if (containsMaskedCredential(input.credentials)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Enter the real credential value — the masked placeholder cannot be saved.',
        });
      }

      await assertBotFeatureAccess({
        action: 'manage',
        applicationId: input.applicationId,
        platform: input.platform,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      assertFieldFormatsForTRPC(input.platform, {
        applicationId: input.applicationId,
        credentials: input.credentials,
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
            message: await describeApplicationIdConflict(ctx, input.platform, input.applicationId),
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

      let deleted = await ctx.agentBotProviderModel.delete(input.id);
      // Only the routing identifiers are needed downstream, so keep this
      // independent of whether the row came back decrypted or raw.
      let routing = existing && {
        applicationId: existing.applicationId,
        platform: existing.platform,
      };

      // Nothing matched in the caller's scope. The binding may still exist in
      // their other scope — a personal session cannot see a workspace row and
      // vice versa — where it stays invisible to `list` yet keeps holding the
      // global (platform, applicationId) key. Let the creator reclaim it from
      // either side rather than reporting a delete that never happened.
      if (deleted.length === 0) {
        const stranded = await ctx.agentBotProviderModel.findByIdAcrossScopes(input.id);

        // A binding owned by someone else is not the caller's to delete, and
        // saying so would confirm it exists — both answer NOT_FOUND.
        if (!stranded || stranded.userId !== ctx.userId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: BOT_NOT_FOUND_MESSAGE });
        }

        // Having created it is not enough when it lives in a workspace: the
        // procedure's `agent:update` gate only covers the *active* scope, so
        // without this a creator who has since left that workspace could reach
        // in from personal scope and kill an integration the team still runs.
        await assertStrandedWorkspaceStillManageable(ctx, stranded.workspaceId);

        deleted = await ctx.agentBotProviderModel.deleteAcrossScopes(input.id);
        routing = { applicationId: stranded.applicationId, platform: stranded.platform };
      }

      // Stop running client and invalidate cached bot
      if (routing) {
        const service = new GatewayService();
        await service.stopClient(routing.platform, routing.applicationId, ctx.userId);
        await getBotMessageRouter().invalidateBot(routing.platform, routing.applicationId);
      }

      return deleted;
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
        // The detail surface needs to show which credentials are configured,
        // never what they are. `update` resolves the mask back to the stored
        // secret, so an edit form can round-trip this safely.
        credentials: maskCredentials(p.platform, p.credentials),
        runtimeStatus: statuses[i].status,
        // Show the strategy the runtime will actually use. A channel created
        // before `burst` existed still stores `queue`, which its platform no
        // longer offers; rendering that raw would also let an untouched save
        // persist its stale window as a real collection window.
        settings: withResolvedConcurrencySettings(
          p.platform,
          p.settings as Record<string, unknown> | undefined,
        ),
      }));
    }),

  /**
   * The one read that returns credentials in the clear, for taking a channel
   * somewhere else.
   *
   * Everything else masks, because an ambient read handing out secrets to
   * anyone who can see the channel is what made a workspace's tokens
   * collectable. Export is not ambient: it is a deliberate act, it sits behind
   * the write gate so viewers cannot reach it, and each row still has to pass
   * the creator / workspace-owner check. The file it produces holds real
   * secrets — the caller is told so.
   */
  exportByAgentId: agentBotProviderProcedureWrite
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const providers = await ctx.agentBotProviderModel.findByAgentId(input.agentId);

      for (const provider of providers) {
        assertWorkspaceRowManageable(ctx, provider.userId, 'bot provider');
      }

      return providers.map((p) => ({
        applicationId: p.applicationId,
        credentials: p.credentials,
        enabled: p.enabled,
        platform: p.platform,
        settings: p.settings,
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

      return providers.map(({ credentials: _credentials, ...p }, i) => ({
        ...p,
        // A list is an inventory, not a place to hand out secrets — not even
        // the caller's own. Read one channel through `getByAgentId` to see
        // which credentials are set.
        runtimeStatus: statuses[i].status,
        // Show the strategy the runtime will actually use. A channel created
        // before `burst` existed still stores `queue`, which its platform no
        // longer offers; rendering that raw would also let an untouched save
        // persist its stale window as a real collection window.
        settings: withResolvedConcurrencySettings(
          p.platform,
          p.settings as Record<string, unknown> | undefined,
        ),
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

  /**
   * Resolve the operator's own `open_id` from the Feishu / Lark app's
   * credentials, so the channel form can fill `settings.userId` in one click.
   *
   * Feishu `open_id`s are per-application, so there is no console page where
   * an operator can look up their own id for this bot; without this the only
   * route is DMing the bot `/whoami`. The app owner is the one personal
   * identity the platform will hand back to the app itself.
   *
   * The display name is best-effort on purpose: it needs a contact scope the
   * bot may not hold, and a missing name must not fail a lookup that already
   * succeeded. When it is there, the form can name who it filled in — an app
   * an admin created on someone else's behalf resolves to that admin, and the
   * operator has to notice that before saving.
   */
  feishuFetchOwnerId: authedProcedure
    .input(
      z.object({
        appId: z.string().min(1),
        appSecret: z.string().min(1),
        platform: z.enum(['feishu', 'lark']),
      }),
    )
    .mutation(async ({ input }) => {
      const api = new LarkApiClient(input.appId, input.appSecret, input.platform);
      try {
        const owner = await api.getAppOwnerId();
        if (!owner) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message:
              'The app info carries no personal open_id for its owner or creator. Send /whoami to the bot instead.',
          });
        }
        const info = await api.getUserInfo(owner.openId).catch(() => null);
        return { name: info?.name, openId: owner.openId, source: owner.source };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            error instanceof Error ? error.message : 'Failed to fetch app info from Feishu / Lark',
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
      // The detail surface hands out masks, so an untouched field comes back as
      // one. Resolve each mask to the secret it stood for before anything else
      // looks at the value: the model replaces the credential blob wholesale,
      // so dropping the masked keys would delete those secrets instead, and the
      // format check below would reject the mask outright.
      if (value.credentials) {
        value.credentials = resolveMaskedCredentials(value.credentials, existing?.credentials);
      }

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

      // Only the sections the caller actually sent are checked, so a partial
      // update (e.g. toggling a setting) never trips on untouched fields.
      assertFieldFormatsForTRPC(targetPlatform, {
        applicationId: value.applicationId,
        credentials: value.credentials,
      });

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
