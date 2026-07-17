import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import type { BotProviderQuery } from '@lobechat/builtin-tool-message/executionRuntime';
import { MessageExecutionRuntime } from '@lobechat/builtin-tool-message/executionRuntime';
import { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import { QQApiClient } from '@lobechat/chat-adapter-qq';
import { WechatApiClient } from '@lobechat/chat-adapter-wechat';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { assertBotFeatureAccess, BotFeatureAccessError } from '@/business/server/bot/featureAccess';
import {
  getEnabledMessengerPlatforms,
  getMessengerDiscordConfig,
  getMessengerSlackConfig,
  getMessengerTelegramConfig,
} from '@/config/messenger';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { MessengerInstallationModel } from '@/database/models/messengerInstallation';
import { agents } from '@/database/schemas';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  assertBotAccessSettings,
  assertWatchKeywordsWritable,
  invalidateBotAfterUpdate,
  mergeBotSettingsForPersist,
} from '@/server/services/bot/agentBotProviderSettings';
import { platformRegistry } from '@/server/services/bot/platforms';
import { DiscordApi } from '@/server/services/bot/platforms/discord/api';
import { DiscordMessageService } from '@/server/services/bot/platforms/discord/service';
import { FeishuMessageService } from '@/server/services/bot/platforms/feishu/service';
import { ImessageDesktopBridgeApi } from '@/server/services/bot/platforms/imessage/desktopBridge';
import { ImessageMessageService } from '@/server/services/bot/platforms/imessage/service';
import { QQMessageService } from '@/server/services/bot/platforms/qq/service';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { SlackMessageService } from '@/server/services/bot/platforms/slack/service';
import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';
import { TelegramMessageService } from '@/server/services/bot/platforms/telegram/service';
import { WechatMessageService } from '@/server/services/bot/platforms/wechat/service';
import { GatewayService } from '@/server/services/gateway';
import { getBotRuntimeStatus } from '@/server/services/gateway/runtimeStatus';
import { messengerPlatformRegistry } from '@/server/services/messenger';
import { TELEGRAM_INSTALLATION_KEY } from '@/server/services/messenger/installations/telegram';

import type { ServerRuntimeRegistration } from '../types';
import { MessageDispatcherService } from './MessageDispatcherService';

/**
 * Shape returned by `listMessengers` / `getMessengerDetail` to the tool runtime.
 * Mirrors the public Z schema in builtin-tool-message; declared here so the
 * Telegram synthesis path produces an entry shape-identical to the DB-backed
 * rows without duplicating the column-mapping logic in three places.
 */
type MessengerInstallationView = {
  applicationId: string;
  enterpriseId: string | null;
  id: string;
  installedAt: string;
  isEnterpriseInstall: boolean;
  platform: string;
  scope: string;
  tenantId: string;
  tenantName: string;
};

/**
 * Telegram bots are env-backed singletons — they never get a row in
 * `messenger_installations` (see `installations/telegram.ts`). Without this
 * synthesis the agent's two-step outbound discovery (`listBots` → fallback
 * `listMessengers`) sees Telegram nowhere and falsely concludes the platform
 * is unconfigured, even while it is actively replying inside a Telegram chat.
 *
 * Returns a virtual install entry when both gates pass:
 *   1. Env has Telegram config (otherwise the singleton genuinely isn't set up)
 *   2. The current user has an account link for `platform='telegram'`
 *      (otherwise the install exists globally but isn't routed to this user —
 *      surfacing it would let any user send through a bot they haven't linked)
 */
const maybeSynthesizeTelegramInstall = async (
  serverDB: NonNullable<Parameters<typeof MessengerInstallationModel.listByInstallerUserId>[0]>,
  userId: string,
): Promise<MessengerInstallationView | undefined> => {
  const telegramConfig = await getMessengerTelegramConfig();
  if (!telegramConfig) return undefined;

  const link = await new MessengerAccountLinkModel(serverDB, userId).findByPlatform('telegram');
  if (!link) return undefined;

  return {
    applicationId: TELEGRAM_INSTALLATION_KEY,
    enterpriseId: null,
    id: TELEGRAM_INSTALLATION_KEY,
    installedAt:
      link.createdAt instanceof Date ? link.createdAt.toISOString() : String(link.createdAt),
    isEnterpriseInstall: false,
    platform: 'telegram',
    scope: '',
    tenantId: '',
    tenantName: 'Telegram',
  };
};

/**
 * Resolves credentials for the given platform from the user's configured bot providers.
 *
 * Every outbound platform service is built through here, so this is also the
 * runtime paid-feature gate: an enabled provider whose plan no longer covers
 * the channel must not keep sending through the Message tool while the
 * inbound/gateway paths are already denied.
 */
const resolveCredentials = async (
  providerModel: AgentBotProviderModel,
  platform: string,
  userId: string,
): Promise<{ applicationId: string; credentials: Record<string, string> }> => {
  const providers = await providerModel.query({ platform });
  const enabled = providers.find((p) => p.enabled);
  if (!enabled?.credentials) {
    throw new Error(
      `No enabled ${platform} bot provider found. ` +
        `Please configure a ${platform} integration in your bot settings.`,
    );
  }
  await assertBotFeatureAccess({
    action: 'runtime',
    applicationId: enabled.applicationId,
    platform,
    userId,
    workspaceId: enabled.workspaceId ?? undefined,
  });
  return { applicationId: enabled.applicationId, credentials: enabled.credentials };
};

export const messageRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Message tool execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Message tool execution');
    }

    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    // Mirror the TRPC router (agentBotProviderProcedure): workspace runs scope
    // bot rows and paid-feature checks to the workspace, not the personal plan.
    const providerModel = new AgentBotProviderModel(
      context.serverDB,
      context.userId,
      gateKeeper,
      context.workspaceId ?? undefined,
    );

    const service = new MessageDispatcherService({
      discord: async () => {
        const { credentials } = await resolveCredentials(providerModel, 'discord', context.userId!);
        return new DiscordMessageService(new DiscordApi(credentials.botToken));
      },
      feishu: async () => {
        const { applicationId, credentials } = await resolveCredentials(
          providerModel,
          'feishu',
          context.userId!,
        );
        return new FeishuMessageService(
          new LarkApiClient(applicationId, credentials.appSecret, 'feishu'),
          'feishu',
        );
      },
      imessage: async () => {
        const { applicationId, credentials } = await resolveCredentials(
          providerModel,
          'imessage',
          context.userId!,
        );
        return new ImessageMessageService(
          new ImessageDesktopBridgeApi({
            applicationId,
            deviceId: credentials.desktopDeviceId,
            userId: context.userId!,
          }),
        );
      },
      lark: async () => {
        const { applicationId, credentials } = await resolveCredentials(
          providerModel,
          'lark',
          context.userId!,
        );
        return new FeishuMessageService(
          new LarkApiClient(applicationId, credentials.appSecret, 'lark'),
          'lark',
        );
      },
      qq: async () => {
        const { applicationId, credentials } = await resolveCredentials(
          providerModel,
          'qq',
          context.userId!,
        );
        return new QQMessageService(new QQApiClient(applicationId, credentials.appSecret));
      },
      slack: async () => {
        const { credentials } = await resolveCredentials(providerModel, 'slack', context.userId!);
        return new SlackMessageService(new SlackApi(credentials.botToken));
      },
      telegram: async () => {
        // Per-agent provider takes precedence; fall back to the env-backed
        // singleton so the synthetic telegram:singleton install actually works.
        try {
          const { credentials } = await resolveCredentials(
            providerModel,
            'telegram',
            context.userId!,
          );
          return new TelegramMessageService(new TelegramApi(credentials.botToken));
        } catch (error) {
          // A paid-gate denial is not a "provider missing" condition — falling
          // back to the env singleton here would bypass the feature gate.
          if (error instanceof BotFeatureAccessError) throw error;
          const envConfig = await getMessengerTelegramConfig();
          if (!envConfig) {
            throw new Error(
              'No enabled telegram bot provider found and no env-backed Telegram config available. ' +
                'Please configure a telegram integration in your bot settings.',
              { cause: error },
            );
          }
          return new TelegramMessageService(new TelegramApi(envConfig.botToken));
        }
      },
      wechat: async () => {
        const { applicationId, credentials } = await resolveCredentials(
          providerModel,
          'wechat',
          context.userId!,
        );
        return new WechatMessageService(
          new WechatApiClient(credentials.botToken, credentials.botId),
          applicationId,
        );
      },
    });

    const botProvider: BotProviderQuery = {
      connectBot: async (botId) => {
        const bot = await providerModel.findById(botId);
        if (!bot) throw new Error(`Bot not found: ${botId}`);
        await assertBotFeatureAccess({
          action: 'manage',
          applicationId: bot.applicationId,
          platform: bot.platform,
          userId: context.userId!,
          workspaceId: bot.workspaceId ?? undefined,
        });
        const gateway = new GatewayService();
        const status = await gateway.startClient(bot.platform, bot.applicationId, context.userId!);
        return { status };
      },
      createBot: async (params) => {
        await assertBotFeatureAccess({
          action: 'manage',
          applicationId: params.applicationId,
          platform: params.platform,
          userId: context.userId!,
          workspaceId: context.workspaceId ?? undefined,
        });
        const settings = mergeBotSettingsForPersist(params.platform, params.settings);
        assertBotAccessSettings(settings);
        await assertWatchKeywordsWritable({
          applicationId: params.applicationId,
          platform: params.platform,
          settings,
          userId: context.userId!,
          workspaceId: context.workspaceId ?? undefined,
        });
        const result = await providerModel.create({ ...params, settings });
        return { id: result.id, platform: params.platform };
      },
      deleteBot: async (botId) => {
        const existing = await providerModel.findById(botId);
        await providerModel.delete(botId);
        if (existing) {
          await invalidateBotAfterUpdate(
            {
              applicationId: existing.applicationId,
              platform: existing.platform,
              userId: context.userId!,
            },
            { enabled: false },
          );
        }
      },
      getBotDetail: async (botId) => {
        const bot = await providerModel.findById(botId);
        if (!bot) return null;
        const status = await getBotRuntimeStatus(bot.platform, bot.applicationId);
        return {
          applicationId: bot.applicationId,
          enabled: bot.enabled,
          id: bot.id,
          platform: bot.platform,
          runtimeStatus: status.status,
          settings: (bot.settings as Record<string, unknown>) ?? undefined,
        };
      },
      listBots: async () => {
        if (!context.agentId) {
          throw new Error('agentId is required to list bots');
        }
        const providers = await providerModel.findByAgentId(context.agentId);

        const statuses = await Promise.all(
          providers.map((p) => getBotRuntimeStatus(p.platform, p.applicationId)),
        );
        return providers.map((p, i) => ({
          applicationId: p.applicationId,
          enabled: p.enabled,
          id: p.id,
          serverId: (p.settings as any)?.serverId as string | undefined,
          userId: (p.settings as any)?.userId as string | undefined,
          platform: p.platform,
          runtimeStatus: statuses[i].status,
        }));
      },
      listPlatforms: async () => {
        return platformRegistry.listSerializedPlatforms().map((p) => {
          const credSchema = (p.schema ?? []).find(
            (f: any) => f.key === 'credentials' && f.properties,
          );
          const credFields = (credSchema as any)?.properties ?? [];
          return {
            credentialFields: credFields.map((f: any) => ({
              key: f.key,
              label: f.label ?? f.key,
              required: !!f.required,
              type: f.type ?? 'string',
            })),
            id: p.id,
            name: p.name,
          };
        });
      },
      toggleBot: async (botId, enabled) => {
        const existing = await providerModel.findById(botId);
        if (!existing) throw new Error(`Bot not found: ${botId}`);
        if (enabled) {
          await assertBotFeatureAccess({
            action: 'manage',
            applicationId: existing.applicationId,
            platform: existing.platform,
            userId: context.userId!,
            workspaceId: existing.workspaceId ?? undefined,
          });
        }
        await providerModel.update(botId, { enabled });
        await invalidateBotAfterUpdate(
          {
            applicationId: existing.applicationId,
            platform: existing.platform,
            userId: context.userId!,
          },
          { enabled },
        );
      },
      updateBot: async (botId, params) => {
        const existing = await providerModel.findById(botId);
        if (!existing) throw new Error(`Bot not found: ${botId}`);
        await assertBotFeatureAccess({
          action: 'manage',
          applicationId: existing.applicationId,
          platform: existing.platform,
          userId: context.userId!,
          workspaceId: existing.workspaceId ?? undefined,
        });

        const value: { credentials?: Record<string, string>; settings?: Record<string, unknown> } =
          {};
        if (params.credentials !== undefined) value.credentials = params.credentials;
        if (params.settings !== undefined) {
          const merged = mergeBotSettingsForPersist(existing.platform, params.settings);
          assertBotAccessSettings(merged);
          await assertWatchKeywordsWritable({
            applicationId: existing.applicationId,
            existingSettings: existing.settings,
            platform: existing.platform,
            settings: merged,
            userId: context.userId!,
            workspaceId: existing.workspaceId ?? undefined,
          });
          value.settings = merged;
        }

        await providerModel.update(botId, value);
        await invalidateBotAfterUpdate(
          {
            applicationId: existing.applicationId,
            platform: existing.platform,
            settings: existing.settings,
            userId: context.userId!,
          },
          value,
        );
      },

      // ─── System Bot messenger management ─────────────────────────────────
      // Mirrors `messenger.*` TRPC procedures but exposed via the tool runtime
      // so LLM-driven flows can manage installs + links the same way the
      // Settings → Messenger UI does. Each handler enforces user ownership;
      // the underlying models are already user-scoped where applicable.
      listMessengers: async () => {
        if (!context.userId || !context.serverDB) {
          throw new Error('userId and serverDB are required to list System Bot installations');
        }
        const linkGateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
        const rows = await MessengerInstallationModel.listByInstallerUserId(
          context.serverDB,
          context.userId,
          linkGateKeeper,
        );
        // We intentionally skip the Slack auth.test reconciliation that the
        // `messenger.listMyInstallations` TRPC procedure runs. A stale Slack
        // install will still appear here; the actual send/uninstall call will
        // surface the underlying token error if and when it matters.
        const installations: MessengerInstallationView[] = rows
          .filter((row) => !row.revokedAt)
          .map((row) => ({
            applicationId: row.applicationId,
            enterpriseId:
              ((row.metadata as Record<string, unknown> | null)?.enterpriseId as
                string | null | undefined) ?? null,
            id: row.id,
            installedAt:
              row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
            isEnterpriseInstall:
              (row.metadata as Record<string, unknown> | null)?.isEnterpriseInstall === true,
            platform: row.platform,
            scope: ((row.metadata as Record<string, unknown> | null)?.scope as string) ?? '',
            tenantId: row.tenantId,
            tenantName:
              ((row.metadata as Record<string, unknown> | null)?.tenantName as string) ?? '',
          }));

        const telegramView = await maybeSynthesizeTelegramInstall(context.serverDB, context.userId);
        if (telegramView) installations.push(telegramView);

        return installations;
      },

      getMessengerDetail: async (installationId) => {
        if (!context.userId || !context.serverDB) {
          throw new Error('userId and serverDB are required to load installation');
        }
        // Telegram singleton has no DB row — synthesize the detail view from
        // env config + the caller's account link. Without this branch the
        // synthetic install id returned by `listMessengers` would 404 here.
        if (installationId === TELEGRAM_INSTALLATION_KEY) {
          const telegramView = await maybeSynthesizeTelegramInstall(
            context.serverDB,
            context.userId,
          );
          if (!telegramView) return null;
          return { ...telegramView, revokedAt: null };
        }
        const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
        const row = await MessengerInstallationModel.findById(
          context.serverDB,
          installationId,
          gateKeeper,
        );
        if (!row) return null;
        // Same ownership guard as `messenger.uninstallInstallation` — the
        // installer is the only user who can see install metadata via the tool.
        if (row.installedByUserId !== context.userId) {
          throw new Error('You can only view installations you initiated');
        }
        return {
          applicationId: row.applicationId,
          enterpriseId:
            ((row.metadata as Record<string, unknown> | null)?.enterpriseId as
              string | null | undefined) ?? null,
          id: row.id,
          installedAt:
            row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
          isEnterpriseInstall:
            (row.metadata as Record<string, unknown> | null)?.isEnterpriseInstall === true,
          platform: row.platform,
          revokedAt:
            row.revokedAt instanceof Date ? row.revokedAt.toISOString() : (row.revokedAt ?? null),
          scope: ((row.metadata as Record<string, unknown> | null)?.scope as string) ?? '',
          tenantId: row.tenantId,
          tenantName:
            ((row.metadata as Record<string, unknown> | null)?.tenantName as string) ?? '',
        };
      },

      uninstallMessenger: async (installationId) => {
        if (!context.userId || !context.serverDB) {
          throw new Error('userId and serverDB are required to uninstall');
        }
        // Telegram is env-backed and shared across all users — there is no
        // installation row to revoke. Direct callers to `unlinkMessenger`,
        // which removes only this user's routing without affecting anyone else.
        if (installationId === TELEGRAM_INSTALLATION_KEY) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Telegram is a global env-backed bot and cannot be uninstalled here. ' +
              "Use unlinkMessenger({ platform: 'telegram' }) to remove your own routing.",
          });
        }
        const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
        const row = await MessengerInstallationModel.findById(
          context.serverDB,
          installationId,
          gateKeeper,
        );
        if (!row) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Installation not found: ${installationId}`,
          });
        }
        if (row.installedByUserId !== context.userId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You can only uninstall installations you initiated',
          });
        }
        await MessengerInstallationModel.markRevoked(context.serverDB, row.id);
      },

      listMessengerPlatforms: async () => {
        // Mirror of `messenger.availablePlatforms` — surfaces per-deployment
        // OAuth deep-link fields (appId / botUsername) so the LLM can tell the
        // user *which* LobeHub bot identity they'd be installing.
        const enabled = await getEnabledMessengerPlatforms();
        const enabledSet = new Set<string>(enabled);
        const definitions = messengerPlatformRegistry
          .listSerializedPlatforms()
          .filter((def) => enabledSet.has(def.id));

        const [discordConfig, slackConfig, telegramConfig] = await Promise.all([
          enabledSet.has('discord') ? getMessengerDiscordConfig() : Promise.resolve(null),
          enabledSet.has('slack') ? getMessengerSlackConfig() : Promise.resolve(null),
          enabledSet.has('telegram') ? getMessengerTelegramConfig() : Promise.resolve(null),
        ]);

        return definitions.map((def) => ({
          appId:
            def.id === 'slack'
              ? slackConfig?.appId
              : def.id === 'discord'
                ? discordConfig?.applicationId
                : undefined,
          botUsername: def.id === 'telegram' ? telegramConfig?.botUsername : undefined,
          id: def.id,
          name: def.name,
        }));
      },

      listMessengerLinks: async () => {
        if (!context.userId || !context.serverDB) {
          throw new Error('userId and serverDB are required to list account links');
        }
        const linkModel = new MessengerAccountLinkModel(context.serverDB, context.userId);
        const rows = await linkModel.list();
        return rows.map((row) => ({
          activeAgentId: row.activeAgentId ?? null,
          createdAt:
            row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
          platform: row.platform,
          platformUserId: row.platformUserId,
          platformUsername: row.platformUsername ?? undefined,
          tenantId: row.tenantId || undefined,
        }));
      },

      setMessengerActiveAgent: async (params) => {
        if (!context.userId || !context.serverDB) {
          throw new Error('userId and serverDB are required');
        }
        // Validate agent ownership before mutating the link — matches the
        // `messenger.setActiveAgent` behavior (rejects cross-user agent ids).
        if (params.agentId !== null) {
          const [agentRow] = await context.serverDB
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.id, params.agentId), eq(agents.userId, context.userId)))
            .limit(1);
          if (!agentRow) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: `Agent not found or not owned by you: ${params.agentId}`,
            });
          }
        }
        const linkModel = new MessengerAccountLinkModel(context.serverDB, context.userId);
        // This in-chat tool only resolves personal-owned agents (validated
        // above via `agents.userId === userId`), so the active scope is always
        // personal (`workspaceId: null`).
        const updated = await linkModel.setActiveAgent(
          params.platform,
          params.agentId,
          null,
          params.tenantId,
        );
        if (!updated) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `No account link found for ${params.platform}${params.tenantId ? ` (tenant ${params.tenantId})` : ''}. The user must complete verify-im first.`,
          });
        }
      },

      unlinkMessenger: async (params) => {
        if (!context.userId || !context.serverDB) {
          throw new Error('userId and serverDB are required');
        }
        const linkModel = new MessengerAccountLinkModel(context.serverDB, context.userId);
        await linkModel.deleteByPlatform(params.platform, params.tenantId);
      },
    };

    return new MessageExecutionRuntime({ botProvider, service });
  },
  identifier: MessageToolIdentifier,
};
