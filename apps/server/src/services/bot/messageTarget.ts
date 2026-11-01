import type { MessagePlatformType } from '@lobechat/builtin-tool-message';
import type { MessageRuntimeService } from '@lobechat/builtin-tool-message/executionRuntime';
import { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import { QQApiClient } from '@lobechat/chat-adapter-qq';
import { WechatApiClient } from '@lobechat/chat-adapter-wechat';
import { TRPCError } from '@trpc/server';

import type { MessengerPlatform } from '@/config/messenger';
import { getMessengerTelegramConfig } from '@/config/messenger';
import type {
  AgentBotProviderModel,
  DecryptedBotProvider,
} from '@/database/models/agentBotProvider';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { MessengerInstallationModel } from '@/database/models/messengerInstallation';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { mergeWithDefaults, platformRegistry } from '@/server/services/bot/platforms';
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
import { getInstallationStore } from '@/server/services/messenger/installations';
import { TELEGRAM_INSTALLATION_KEY } from '@/server/services/messenger/installations/telegram';

/**
 * A concrete outbound connection for the `lobe-message` send APIs: the
 * platform service built from one bot's credentials, plus which bot it is.
 */
export interface ResolvedMessageTarget {
  /** Platform-side bot identity (e.g. the WeChat iLink App ID). */
  applicationId: string;
  platform: MessagePlatformType;
  service: MessageRuntimeService;
  settings: Record<string, unknown>;
}

/**
 * Build a `MessageRuntimeService` from raw platform + applicationId +
 * credentials. Shared by every resolution source — per-agent bot channels
 * (`agent_bot_providers`), System Bot connections (`messenger_installations`
 * / WeChat account links) and inbound messenger installation keys — so the
 * downstream behavior (attachments included) is identical regardless of
 * where the credentials came from.
 *
 * `userId` is only needed by iMessage, whose desktop bridge is addressed per
 * user; without it iMessage is reported as unsupported.
 */
export const createMessageServiceForCredentials = (
  platform: string,
  applicationId: string,
  credentials: Record<string, any>,
  options: { userId?: string } = {},
): MessageRuntimeService => {
  switch (platform) {
    case 'discord': {
      return new DiscordMessageService(new DiscordApi(credentials.botToken));
    }
    case 'slack': {
      return new SlackMessageService(new SlackApi(credentials.botToken));
    }
    case 'telegram': {
      return new TelegramMessageService(new TelegramApi(credentials.botToken));
    }
    case 'feishu': {
      return new FeishuMessageService(
        new LarkApiClient(applicationId, credentials.appSecret, 'feishu'),
        'feishu',
      );
    }
    case 'lark': {
      return new FeishuMessageService(
        new LarkApiClient(applicationId, credentials.appSecret, 'lark'),
        'lark',
      );
    }
    case 'qq': {
      return new QQMessageService(new QQApiClient(applicationId, credentials.appSecret));
    }
    case 'wechat': {
      return new WechatMessageService(
        // `baseUrl` is issued during QR confirmation and must be honored when
        // it differs from the default endpoint (see wechat/protocol-spec.md).
        new WechatApiClient(credentials.botToken, credentials.botId, credentials.baseUrl),
        applicationId,
      );
    }
    case 'imessage': {
      if (options.userId) {
        return new ImessageMessageService(
          new ImessageDesktopBridgeApi({
            applicationId,
            deviceId: credentials.desktopDeviceId,
            userId: options.userId,
          }),
        );
      }
      break;
    }
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `Unsupported platform: ${platform}`,
  });
};

/** Resolve a per-agent bot (`listBots` → `botId`) into a runnable target. */
export const resolveBotMessageTarget = async (
  model: AgentBotProviderModel,
  botId: string,
  options: { userId?: string } = {},
): Promise<ResolvedMessageTarget & { provider: DecryptedBotProvider }> => {
  const provider = await model.findById(botId);
  if (!provider) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Bot not found: ${botId}` });
  }
  if (!provider.enabled) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Bot is disabled: ${botId}` });
  }
  const definition = platformRegistry.getPlatform(provider.platform);
  const settings = definition
    ? mergeWithDefaults(definition.schema, provider.settings as Record<string, unknown> | undefined)
    : ((provider.settings as Record<string, unknown>) ?? {});
  return {
    applicationId: provider.applicationId,
    platform: provider.platform as MessagePlatformType,
    provider,
    service: createMessageServiceForCredentials(
      provider.platform,
      provider.applicationId,
      provider.credentials as Record<string, any>,
      options,
    ),
    settings,
  };
};

/**
 * Resolve a user-owned System Bot connection (`listMessengers` →
 * `messengerInstallationId`) into a runnable target.
 */
export const resolveMessengerInstallTarget = async (
  ctx: { serverDB: any; userId: string },
  installationId: string,
): Promise<ResolvedMessageTarget> => {
  // Telegram is env-backed and never lives in `messenger_installations`. The
  // synthetic id surfaced by `listMessengers` would 404 on `findById`, so
  // short-circuit here: pull the bot token from env config and gate on the
  // caller having an account link (analogue of the per-row ownership check).
  if (installationId === TELEGRAM_INSTALLATION_KEY) {
    const telegramConfig = await getMessengerTelegramConfig();
    if (!telegramConfig) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Telegram messenger is not configured on this deployment',
      });
    }
    const link = await new MessengerAccountLinkModel(ctx.serverDB, ctx.userId).findByPlatform(
      'telegram',
    );
    if (!link) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message:
          'You can only send through Telegram after linking your account. ' +
          'Open the Telegram bot and run /start to create the link.',
      });
    }
    return {
      applicationId: TELEGRAM_INSTALLATION_KEY,
      platform: 'telegram',
      service: createMessageServiceForCredentials('telegram', TELEGRAM_INSTALLATION_KEY, {
        botToken: telegramConfig.botToken,
      }),
      settings: {},
    };
  }

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
  const wechatLink = await new MessengerAccountLinkModel(
    ctx.serverDB,
    ctx.userId,
  ).findByIdWithCredentials(installationId, 'wechat', gateKeeper);
  if (wechatLink) {
    if (!wechatLink.applicationId || typeof wechatLink.credentials.botToken !== 'string') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `WeChat connection credentials are unavailable: ${installationId}`,
      });
    }
    return {
      applicationId: wechatLink.applicationId,
      platform: 'wechat',
      service: createMessageServiceForCredentials(
        'wechat',
        wechatLink.applicationId,
        wechatLink.credentials,
      ),
      settings: {},
    };
  }

  const row = await MessengerInstallationModel.findById(ctx.serverDB, installationId, gateKeeper);
  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Messenger installation not found: ${installationId}`,
    });
  }
  if (row.revokedAt) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Messenger installation has been revoked: ${installationId}`,
    });
  }
  if (row.installedByUserId !== ctx.userId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You can only send through messenger installs you initiated',
    });
  }
  return {
    applicationId: row.applicationId,
    platform: row.platform as MessagePlatformType,
    service: createMessageServiceForCredentials(
      row.platform,
      row.applicationId,
      row.credentials as Record<string, any>,
    ),
    settings: {},
  };
};

/**
 * Resolve the System Bot connection an inbound IM run arrived on, from the
 * `messengerInstallationKey` (`<platform>:<tenantId>` / `<platform>:singleton`)
 * that `MessengerRouter` stamps on the topic's bot context. Same installation
 * store `BotCallbackService` uses to post the run's own reply, so a send from
 * the tool goes out through exactly the connection the reply does.
 *
 * Returns undefined when the install no longer resolves (revoked, credentials
 * gone) — the caller then falls back to platform-level routing.
 */
export const resolveMessengerKeyTarget = async (
  platform: string,
  installationKey: string,
): Promise<ResolvedMessageTarget | undefined> => {
  const store = getInstallationStore(platform as MessengerPlatform);
  if (!store) return undefined;
  const creds = await store.resolveByKey(installationKey);
  if (!creds) return undefined;
  return {
    applicationId: creds.applicationId,
    platform: platform as MessagePlatformType,
    service: createMessageServiceForCredentials(platform, creds.applicationId, {
      baseUrl: creds.baseUrl,
      botId: creds.botId,
      botToken: creds.botToken,
    }),
    settings: {},
  };
};
