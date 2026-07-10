import type { MessagePlatformType } from '@lobechat/builtin-tool-message';
import type { MessageRuntimeService } from '@lobechat/builtin-tool-message/executionRuntime';
import { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import { QQApiClient } from '@lobechat/chat-adapter-qq';
import { WechatApiClient } from '@lobechat/chat-adapter-wechat';
import {
  DEFAULT_BOT_HISTORY_LIMIT,
  MAX_BOT_HISTORY_LIMIT,
  MIN_BOT_HISTORY_LIMIT,
} from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { getMessengerTelegramConfig } from '@/config/messenger';
import type { DecryptedBotProvider } from '@/database/models/agentBotProvider';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { MessengerInstallationModel } from '@/database/models/messengerInstallation';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { mergeWithDefaults, platformRegistry } from '@/server/services/bot/platforms';
import { DiscordApi } from '@/server/services/bot/platforms/discord/api';
import { DiscordMessageService } from '@/server/services/bot/platforms/discord/service';
import { FeishuMessageService } from '@/server/services/bot/platforms/feishu/service';
import { QQMessageService } from '@/server/services/bot/platforms/qq/service';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { SlackMessageService } from '@/server/services/bot/platforms/slack/service';
import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';
import { TelegramMessageService } from '@/server/services/bot/platforms/telegram/service';
import { WechatMessageService } from '@/server/services/bot/platforms/wechat/service';
import { TELEGRAM_INSTALLATION_KEY } from '@/server/services/messenger/installations/telegram';

// ── Middleware ────────────────────────────────────────────

const botMessageProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentBotProviderModel: new AgentBotProviderModel(ctx.serverDB, ctx.userId, gateKeeper, wsId),
    },
  });
});
const botMessageWriteProcedure = botMessageProcedure.use(withScopedPermission('message:create'));

// ── Shared input schemas ─────────────────────────────────

/**
 * Mirror of `SendMessageAttachment` (builtin-tool-message types). Shared
 * across `sendMessage`, `sendDirectMessage`, and `replyToThread` so the
 * three procedures stay in lockstep — the platform-specific helpers
 * downstream only see one shape.
 */
const attachmentsInputSchema = z.array(
  z.object({
    data: z.string().optional(),
    fetchUrl: z.string().url().optional(),
    mimeType: z.string().optional(),
    name: z.string().optional(),
    type: z.enum(['image', 'file', 'video', 'audio']),
  }),
);

// ── Service Factory ──────────────────────────────────────

/**
 * Build a `MessageRuntimeService` from raw platform + applicationId +
 * credentials. Shared between two resolution sources:
 *
 * 1. Per-agent bot channels (`agent_bot_providers` row) — `resolveBot`
 * 2. System Bot messenger installs (`messenger_installations` row) —
 *    `resolveMessengerInstall`
 *
 * Both paths produce the same underlying outbound API client, so the
 * downstream `MessageRuntimeService` behavior (attachments included) is
 * identical regardless of where the credentials came from.
 */
const createServiceForCredentials = (
  platform: string,
  applicationId: string,
  credentials: Record<string, any>,
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
        new WechatApiClient(credentials.botToken, credentials.botId),
        applicationId,
      );
    }
    default: {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unsupported platform: ${platform}`,
      });
    }
  }
};

const createServiceForBot = (provider: DecryptedBotProvider): MessageRuntimeService =>
  createServiceForCredentials(
    provider.platform,
    provider.applicationId,
    provider.credentials as Record<string, any>,
  );

const resolveBot = async (
  model: AgentBotProviderModel,
  botId: string,
): Promise<{
  platform: MessagePlatformType;
  service: MessageRuntimeService;
  settings: Record<string, unknown>;
}> => {
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
    platform: provider.platform as MessagePlatformType,
    service: createServiceForBot(provider),
    settings,
  };
};

/**
 * Resolve a system-bot messenger installation row into a runnable
 * `MessageRuntimeService`. Authorization: only the user who installed the
 * row can target it — workspace admins who installed under a different
 * LobeHub account need their own session.
 */
const resolveMessengerInstall = async (
  ctx: { serverDB: any; userId: string },
  installationId: string,
): Promise<{
  platform: MessagePlatformType;
  service: MessageRuntimeService;
  settings: Record<string, unknown>;
}> => {
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
      platform: 'telegram',
      service: createServiceForCredentials('telegram', TELEGRAM_INSTALLATION_KEY, {
        botToken: telegramConfig.botToken,
      }),
      settings: {},
    };
  }

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
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
    platform: row.platform as MessagePlatformType,
    service: createServiceForCredentials(
      row.platform,
      row.applicationId,
      row.credentials as Record<string, any>,
    ),
    settings: {},
  };
};

/**
 * Common dispatcher: either a per-agent `botId` or a system-bot
 * `messengerInstallationId`. Each procedure's zod input enforces the
 * "exactly one of" constraint at the boundary; this helper assumes that
 * invariant has already been checked.
 */
const resolveSendTarget = async (
  ctx: { agentBotProviderModel: AgentBotProviderModel; serverDB: any; userId: string },
  input: { botId?: string; messengerInstallationId?: string },
): Promise<{
  platform: MessagePlatformType;
  service: MessageRuntimeService;
  settings: Record<string, unknown>;
}> => {
  if (input.botId) return resolveBot(ctx.agentBotProviderModel, input.botId);
  if (input.messengerInstallationId)
    return resolveMessengerInstall(
      { serverDB: ctx.serverDB, userId: ctx.userId },
      input.messengerInstallationId,
    );
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Provide exactly one of botId or messengerInstallationId',
  });
};

// ── Router ───────────────────────────────────────────────

export const botMessageRouter = router({
  // ==================== Direct Messaging ====================

  sendDirectMessage: botMessageWriteProcedure
    .input(
      z
        .object({
          attachments: attachmentsInputSchema.optional(),
          botId: z.string().optional(),
          content: z.string(),
          messengerInstallationId: z.string().optional(),
          userId: z.string(),
        })
        .refine((v) => !!v.botId !== !!v.messengerInstallationId, {
          message: 'Provide exactly one of botId or messengerInstallationId',
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveSendTarget(ctx, input);
      if (!service.sendDirectMessage) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `sendDirectMessage is not supported on ${platform}`,
        });
      }
      return service.sendDirectMessage({
        attachments: input.attachments,
        content: input.content,
        platform,
        userId: input.userId,
      });
    }),

  // ==================== Core Message Operations ====================

  sendMessage: botMessageWriteProcedure
    .input(
      z
        .object({
          attachments: attachmentsInputSchema.optional(),
          botId: z.string().optional(),
          channelId: z.string(),
          content: z.string(),
          embeds: z.array(z.record(z.string(), z.unknown())).optional(),
          messengerInstallationId: z.string().optional(),
          replyTo: z.string().optional(),
        })
        .refine((v) => !!v.botId !== !!v.messengerInstallationId, {
          message: 'Provide exactly one of botId or messengerInstallationId',
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveSendTarget(ctx, input);
      return service.sendMessage({
        attachments: input.attachments,
        channelId: input.channelId,
        content: input.content,
        embeds: input.embeds,
        platform,
        replyTo: input.replyTo,
      });
    }),

  readMessages: botMessageProcedure
    .input(
      z.object({
        after: z
          .string()
          .optional()
          .transform((v) => v || undefined),
        before: z
          .string()
          .optional()
          .transform((v) => v || undefined),
        botId: z.string(),
        channelId: z.string(),
        cursor: z.string().optional(),
        endTime: z.string().optional(),
        limit: z.number().min(MIN_BOT_HISTORY_LIMIT).max(MAX_BOT_HISTORY_LIMIT).optional(),
        startTime: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { service, platform, settings } = await resolveBot(
        ctx.agentBotProviderModel,
        input.botId,
      );
      const defaultLimit = (settings.historyLimit as number) || DEFAULT_BOT_HISTORY_LIMIT;
      return service.readMessages({
        after: input.after,
        before: input.before,
        channelId: input.channelId,
        cursor: input.cursor,
        endTime: input.endTime,
        limit: input.limit ?? defaultLimit,
        platform,
        startTime: input.startTime,
      });
    }),

  editMessage: botMessageWriteProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
        content: z.string(),
        messageId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.editMessage({
        channelId: input.channelId,
        content: input.content,
        messageId: input.messageId,
        platform,
      });
    }),

  deleteMessage: botMessageWriteProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
        messageId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.deleteMessage({
        channelId: input.channelId,
        messageId: input.messageId,
        platform,
      });
    }),

  searchMessages: botMessageProcedure
    .input(
      z.object({
        authorId: z.string().optional(),
        botId: z.string(),
        channelId: z.string(),
        limit: z.number().min(MIN_BOT_HISTORY_LIMIT).max(MAX_BOT_HISTORY_LIMIT).optional(),
        query: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.searchMessages({
        authorId: input.authorId,
        channelId: input.channelId,
        limit: input.limit,
        platform,
        query: input.query,
      });
    }),

  // ==================== Reactions ====================

  reactToMessage: botMessageWriteProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
        emoji: z.string(),
        messageId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.reactToMessage({
        channelId: input.channelId,
        emoji: input.emoji,
        messageId: input.messageId,
        platform,
      });
    }),

  getReactions: botMessageProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
        messageId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.getReactions({
        channelId: input.channelId,
        messageId: input.messageId,
        platform,
      });
    }),

  // ==================== Pin Management ====================

  pinMessage: botMessageWriteProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
        messageId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.pinMessage({
        channelId: input.channelId,
        messageId: input.messageId,
        platform,
      });
    }),

  unpinMessage: botMessageWriteProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
        messageId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.unpinMessage({
        channelId: input.channelId,
        messageId: input.messageId,
        platform,
      });
    }),

  listPins: botMessageProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.listPins({
        channelId: input.channelId,
        platform,
      });
    }),

  // ==================== Channel Management ====================

  getChannelInfo: botMessageProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.getChannelInfo({
        channelId: input.channelId,
        platform,
      });
    }),

  listChannels: botMessageProcedure
    .input(
      z.object({
        botId: z.string(),
        filter: z.string().optional(),
        serverId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.listChannels({
        filter: input.filter,
        platform,
        serverId: input.serverId,
      });
    }),

  // ==================== Member Information ====================

  getMemberInfo: botMessageProcedure
    .input(
      z.object({
        botId: z.string(),
        memberId: z.string(),
        serverId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.getMemberInfo({
        memberId: input.memberId,
        platform,
        serverId: input.serverId,
      });
    }),

  // ==================== Thread Operations ====================

  createThread: botMessageWriteProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
        content: z.string().optional(),
        messageId: z.string().optional(),
        name: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.createThread({
        channelId: input.channelId,
        content: input.content,
        messageId: input.messageId,
        name: input.name,
        platform,
      });
    }),

  listThreads: botMessageProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.listThreads({
        channelId: input.channelId,
        platform,
      });
    }),

  replyToThread: botMessageWriteProcedure
    .input(
      z
        .object({
          attachments: attachmentsInputSchema.optional(),
          botId: z.string().optional(),
          content: z.string(),
          messengerInstallationId: z.string().optional(),
          threadId: z.string(),
        })
        .refine((v) => !!v.botId !== !!v.messengerInstallationId, {
          message: 'Provide exactly one of botId or messengerInstallationId',
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveSendTarget(ctx, input);
      return service.replyToThread({
        attachments: input.attachments,
        content: input.content,
        platform,
        threadId: input.threadId,
      });
    }),

  // ==================== Polls ====================

  createPoll: botMessageWriteProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
        duration: z.number().optional(),
        multipleAnswers: z.boolean().optional(),
        options: z.array(z.string()).min(2),
        question: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.createPoll({
        channelId: input.channelId,
        duration: input.duration,
        multipleAnswers: input.multipleAnswers,
        options: input.options,
        platform,
        question: input.question,
      });
    }),
});
