import type { MessagePlatformType } from '@lobechat/builtin-tool-message';
import type { MessageRuntimeService } from '@lobechat/builtin-tool-message/executionRuntime';
import {
  DEFAULT_BOT_HISTORY_LIMIT,
  MAX_BOT_HISTORY_LIMIT,
  MIN_BOT_HISTORY_LIMIT,
} from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  resolveBotMessageTarget,
  resolveMessengerInstallTarget,
} from '@/server/services/bot/messageTarget';

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
const attachmentsInputSchema = z
  .array(
    z.object({
      data: z.string().optional(),
      fetchUrl: z.string().url().optional(),
      mimeType: z.string().optional(),
      name: z.string().optional(),
      type: z.enum(['image', 'file', 'video', 'audio']),
    }),
  )
  // Bounded like the push path: an unmeasured `fetchUrl` costs a size probe
  // before anything is sent, so an unbounded array is unbounded latency inside
  // one serverless request.
  .max(10);

const embedsInputSchema = z.array(
  z
    .object({
      author: z
        .object({ icon_url: z.string().optional(), name: z.string(), url: z.string().optional() })
        .optional(),
      color: z.union([z.number(), z.string()]).optional(),
      description: z.string().optional(),
      fields: z
        .array(z.object({ inline: z.boolean().optional(), name: z.string(), value: z.string() }))
        .optional(),
      footer: z.object({ icon_url: z.string().optional(), text: z.string() }).optional(),
      image: z.object({ url: z.string() }).optional(),
      thumbnail: z.object({ url: z.string() }).optional(),
      timestamp: z.string().optional(),
      title: z.string().optional(),
      url: z.string().optional(),
    })
    .passthrough(),
);

// ── Target resolution ────────────────────────────────────
// Credential → service resolution lives in `@/server/services/bot/messageTarget`
// so the server tool runtime routes `botId` / `messengerInstallationId`
// exactly like these procedures do.

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
  if (input.botId) return resolveBotMessageTarget(ctx.agentBotProviderModel, input.botId);
  if (input.messengerInstallationId)
    return resolveMessengerInstallTarget(
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
          embeds: embedsInputSchema.optional(),
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
        embeds: input.embeds,
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
          embeds: embedsInputSchema.optional(),
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
      const { service, platform, settings } = await resolveBotMessageTarget(
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

  readDocument: botMessageProcedure
    .input(
      z
        .object({
          botId: z.string(),
          documentId: z.string().optional(),
          url: z.string().optional(),
        })
        .refine((v) => !!v.url || !!v.documentId, {
          message: 'Either url or documentId is required',
        }),
    )
    .query(async ({ input, ctx }) => {
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
      if (!service.readDocument) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `readDocument is not supported on ${platform}`,
        });
      }
      return service.readDocument({
        documentId: input.documentId,
        platform,
        url: input.url,
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
          embeds: embedsInputSchema.optional(),
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
        embeds: input.embeds,
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
      const { service, platform } = await resolveBotMessageTarget(
        ctx.agentBotProviderModel,
        input.botId,
      );
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
