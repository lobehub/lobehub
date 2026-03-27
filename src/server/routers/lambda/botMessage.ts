import { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import { QQApiClient } from '@lobechat/chat-adapter-qq';
import { WechatApiClient } from '@lobechat/chat-adapter-wechat';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { DecryptedBotProvider } from '@/database/models/agentBotProvider';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { DiscordApi } from '@/server/services/bot/platforms/discord/api';
import { DiscordMessageAdapter } from '@/server/services/bot/platforms/discord/service';
import { FeishuMessageAdapter } from '@/server/services/bot/platforms/feishu/service';
import { QQMessageAdapter } from '@/server/services/bot/platforms/qq/service';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { SlackMessageAdapter } from '@/server/services/bot/platforms/slack/service';
import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';
import { TelegramMessageAdapter } from '@/server/services/bot/platforms/telegram/service';
import { WechatMessageAdapter } from '@/server/services/bot/platforms/wechat/service';
import type { MessagePlatformAdapter } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';

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

// ── Adapter Factory ──────────────────────────────────────

const createAdapterForBot = (provider: DecryptedBotProvider): MessagePlatformAdapter => {
  const { platform, applicationId, credentials } = provider;

  switch (platform) {
    case 'discord': {
      return new DiscordMessageAdapter(new DiscordApi(credentials.botToken));
    }
    case 'slack': {
      return new SlackMessageAdapter(new SlackApi(credentials.botToken));
    }
    case 'telegram': {
      return new TelegramMessageAdapter(new TelegramApi(credentials.botToken));
    }
    case 'feishu': {
      return new FeishuMessageAdapter(
        new LarkApiClient(applicationId, credentials.appSecret, 'feishu'),
        'feishu',
      );
    }
    case 'lark': {
      return new FeishuMessageAdapter(
        new LarkApiClient(applicationId, credentials.appSecret, 'lark'),
        'lark',
      );
    }
    case 'qq': {
      return new QQMessageAdapter(new QQApiClient(applicationId, credentials.appSecret));
    }
    case 'wechat': {
      return new WechatMessageAdapter(
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

const resolveAdapter = async (
  model: AgentBotProviderModel,
  botId: string,
): Promise<MessagePlatformAdapter> => {
  const provider = await model.findById(botId);
  if (!provider) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Bot not found: ${botId}` });
  }
  if (!provider.enabled) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Bot is disabled: ${botId}` });
  }
  return createAdapterForBot(provider);
};

// ── Router ───────────────────────────────────────────────

export const botMessageRouter = router({
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.sendMessage({
        channelId: input.channelId,
        content: input.content,
        embeds: input.embeds,
        platform: '' as any, // platform is resolved from bot, adapter ignores this field
        replyTo: input.replyTo,
      });
    }),

  readMessages: botMessageProcedure
    .input(
      z.object({
        after: z.string().optional(),
        before: z.string().optional(),
        botId: z.string(),
        channelId: z.string(),
        limit: z.number().min(1).max(100).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.readMessages({
        after: input.after,
        before: input.before,
        channelId: input.channelId,
        limit: input.limit,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.editMessage({
        channelId: input.channelId,
        content: input.content,
        messageId: input.messageId,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.deleteMessage({
        channelId: input.channelId,
        messageId: input.messageId,
        platform: '' as any,
      });
    }),

  searchMessages: botMessageProcedure
    .input(
      z.object({
        authorId: z.string().optional(),
        botId: z.string(),
        channelId: z.string(),
        limit: z.number().min(1).max(100).optional(),
        query: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.searchMessages({
        authorId: input.authorId,
        channelId: input.channelId,
        limit: input.limit,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.reactToMessage({
        channelId: input.channelId,
        emoji: input.emoji,
        messageId: input.messageId,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.getReactions({
        channelId: input.channelId,
        messageId: input.messageId,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.pinMessage({
        channelId: input.channelId,
        messageId: input.messageId,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.unpinMessage({
        channelId: input.channelId,
        messageId: input.messageId,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.listPins({
        channelId: input.channelId,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.getChannelInfo({
        channelId: input.channelId,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.listChannels({
        filter: input.filter,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.getMemberInfo({
        memberId: input.memberId,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.createThread({
        channelId: input.channelId,
        content: input.content,
        messageId: input.messageId,
        name: input.name,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.listThreads({
        channelId: input.channelId,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.replyToThread({
        content: input.content,
        platform: '' as any,
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
      const adapter = await resolveAdapter(ctx.agentBotProviderModel, input.botId);
      return adapter.createPoll({
        channelId: input.channelId,
        duration: input.duration,
        multipleAnswers: input.multipleAnswers,
        options: input.options,
        platform: '' as any,
        question: input.question,
      });
    }),
});
