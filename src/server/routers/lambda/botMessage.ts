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

import type { DecryptedBotProvider } from '@/database/models/agentBotProvider';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { DiscordApi } from '@/server/services/bot/platforms/discord/api';
import { DiscordMessageService } from '@/server/services/bot/platforms/discord/service';
import { FeishuMessageService } from '@/server/services/bot/platforms/feishu/service';
import { QQMessageService } from '@/server/services/bot/platforms/qq/service';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { SlackMessageService } from '@/server/services/bot/platforms/slack/service';
import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';
import { TelegramMessageService } from '@/server/services/bot/platforms/telegram/service';
import { WechatMessageService } from '@/server/services/bot/platforms/wechat/service';

// ── Middleware ────────────────────────────────────────────

const botMessageProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  return opts.next({
    ctx: {
      agentBotProviderModel: new AgentBotProviderModel(ctx.serverDB, ctx.userId, gateKeeper),
    },
  });
});

// ── Service Factory ──────────────────────────────────────

const createServiceForBot = (provider: DecryptedBotProvider): MessageRuntimeService => {
  const { platform, applicationId, credentials } = provider;

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
  return {
    platform: provider.platform as MessagePlatformType,
    service: createServiceForBot(provider),
    settings: (provider.settings as Record<string, unknown>) ?? {},
  };
};

// ── Router ───────────────────────────────────────────────

export const botMessageRouter = router({
  // ==================== Direct Messaging ====================

  sendDirectMessage: botMessageProcedure
    .input(
      z.object({
        botId: z.string(),
        content: z.string(),
        userId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      if (!service.sendDirectMessage) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `sendDirectMessage is not supported on ${platform}`,
        });
      }
      return service.sendDirectMessage({
        content: input.content,
        platform,
        userId: input.userId,
      });
    }),

  // ==================== Core Message Operations ====================

  sendMessage: botMessageProcedure
    .input(
      z.object({
        botId: z.string(),
        channelId: z.string(),
        content: z.string(),
        embeds: z.array(z.record(z.unknown())).optional(),
        replyTo: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.sendMessage({
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

  editMessage: botMessageProcedure
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

  deleteMessage: botMessageProcedure
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

  reactToMessage: botMessageProcedure
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

  pinMessage: botMessageProcedure
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

  unpinMessage: botMessageProcedure
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

  createThread: botMessageProcedure
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

  replyToThread: botMessageProcedure
    .input(
      z.object({
        botId: z.string(),
        content: z.string(),
        threadId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { service, platform } = await resolveBot(ctx.agentBotProviderModel, input.botId);
      return service.replyToThread({
        content: input.content,
        platform,
        threadId: input.threadId,
      });
    }),

  // ==================== Polls ====================

  createPoll: botMessageProcedure
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
