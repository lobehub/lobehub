import {
  CreateNewMessageParamsSchema,
  UpdateMessageParamsSchema,
  UpdateMessagePluginSchema,
  UpdateMessageRAGParamsSchema,
} from '@lobechat/types';
import { z } from 'zod';

import { MessageModel } from '@/database/models/message';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { MessageService } from '@/server/services/message';

import { resolveAgentIdFromSession, resolveContext } from './_helpers/resolveContext';
import { basicContextSchema } from './_schema/context';

const messageProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      messageService: new MessageService(ctx.serverDB, ctx.userId),
    },
  });
});

export const messageRouter = router({
  addFilesToMessage: messageProcedure
    .input(
      z
        .object({
          fileIds: z.array(z.string()),
          id: z.string(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, fileIds, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.addFilesToMessage(id, fileIds, resolved);
    }),

  count: messageProcedure
    .input(
      z
        .object({
          endDate: z.string().optional(),
          range: z.tuple([z.string(), z.string()]).optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.messageModel.count(input);
    }),

  countWords: messageProcedure
    .input(
      z
        .object({
          endDate: z.string().optional(),
          range: z.tuple([z.string(), z.string()]).optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.messageModel.countWords(input);
    }),

  createMessage: messageProcedure
    .input(CreateNewMessageParamsSchema)
    .mutation(async ({ input, ctx }) => {
      // If there's no agentId but has sessionId, resolve agentId from sessionId
      let agentId = input.agentId;
      if (!agentId && input.sessionId) {
        agentId = (await resolveAgentIdFromSession(input.sessionId, ctx.serverDB, ctx.userId))!;
      }

      // Create message with the resolved agentId
      return ctx.messageService.createMessage({ ...input, agentId } as any);
    }),

  getHeatmaps: messageProcedure.query(async ({ ctx }) => {
    return ctx.messageModel.getHeatmaps();
  }),

  getMessages: messageProcedure
    .input(
      z.object({
        agentId: z.string().nullable().optional(),
        current: z.number().optional(),
        groupId: z.string().nullable().optional(),
        pageSize: z.number().optional(),
        sessionId: z.string().nullable().optional(),
        threadId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.messageModel.query(input, {
        postProcessUrl: (path) => ctx.fileService.getFullFileUrl(path),
      });
    }),

  rankModels: messageProcedure.query(async ({ ctx }) => {
    return ctx.messageModel.rankModels();
  }),

  removeAllMessages: messageProcedure.mutation(async ({ ctx }) => {
    return ctx.messageModel.deleteAllMessages();
  }),

  removeMessage: messageProcedure
    .input(
      z
        .object({
          id: z.string(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.removeMessage(id, resolved);
    }),

  removeMessageQuery: messageProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.messageModel.deleteMessageQuery(input.id);
    }),

  removeMessages: messageProcedure
    .input(
      z
        .object({
          ids: z.array(z.string()),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { ids, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.removeMessages(ids, resolved);
    }),

  removeMessagesByAssistant: messageProcedure
    .input(
      z
        .object({
          groupId: z.string().nullable().optional(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageModel.deleteMessagesBySession(
        resolved.sessionId,
        resolved.topicId,
        input.groupId,
      );
    }),

  removeMessagesByGroup: messageProcedure
    .input(
      z.object({
        groupId: z.string(),
        topicId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.messageModel.deleteMessagesBySession(null, input.topicId, input.groupId);
    }),

  searchMessages: messageProcedure
    .input(z.object({ keywords: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.messageModel.queryByKeyword(input.keywords);
    }),

  update: messageProcedure
    .input(
      z
        .object({
          id: z.string(),
          value: UpdateMessageParamsSchema,
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.updateMessage(id, value as any, resolved);
    }),

  updateMessagePlugin: messageProcedure
    .input(
      z
        .object({
          id: z.string(),
          value: UpdateMessagePluginSchema.partial(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.updateMessagePlugin(id, value, resolved);
    }),

  updateMessageRAG: messageProcedure
    .input(UpdateMessageRAGParamsSchema.extend(basicContextSchema.shape))
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.updateMessageRAG(id, value, resolved);
    }),

  updateMetadata: messageProcedure
    .input(
      z
        .object({
          id: z.string(),
          value: z.object({}).passthrough(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.updateMetadata(id, value, resolved);
    }),

  updatePluginError: messageProcedure
    .input(
      z
        .object({
          id: z.string(),
          value: z.object({}).passthrough().nullable(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.updatePluginError(id, value, resolved);
    }),

  updatePluginState: messageProcedure
    .input(
      z
        .object({
          id: z.string(),
          value: z.object({}).passthrough(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.updatePluginState(id, value, resolved);
    }),

  updateTTS: messageProcedure
    .input(
      z.object({
        id: z.string(),
        value: z
          .object({
            contentMd5: z.string().optional(),
            file: z.string().optional(),
            voice: z.string().optional(),
          })
          .or(z.literal(false)),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.value === false) {
        return ctx.messageModel.deleteMessageTTS(input.id);
      }

      return ctx.messageModel.updateTTS(input.id, input.value);
    }),

  updateToolArguments: messageProcedure
    .input(
      z
        .object({
          toolCallId: z.string(),
          value: z.union([z.string(), z.record(z.unknown())]),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { toolCallId, value, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.updateToolArguments(toolCallId, value, resolved);
    }),

  /**
   * Update tool message with content, metadata, pluginState, and pluginError in a single transaction
   * This prevents race conditions when updating multiple fields
   */
  updateToolMessage: messageProcedure
    .input(
      z
        .object({
          id: z.string(),
          value: z.object({
            content: z.string().optional(),
            metadata: z.object({}).passthrough().optional(),
            pluginError: z.any().optional(),
            pluginState: z.object({}).passthrough().optional(),
          }),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      const resolved = await resolveContext({ agentId, ...options }, ctx.serverDB, ctx.userId);

      return ctx.messageService.updateToolMessage(id, value, resolved);
    }),
  updateTranslate: messageProcedure
    .input(
      z.object({
        id: z.string(),
        value: z
          .object({
            content: z.string().optional(),
            from: z.string().optional(),
            to: z.string(),
          })
          .or(z.literal(false)),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.value === false) {
        return ctx.messageModel.deleteMessageTranslate(input.id);
      }

      return ctx.messageModel.updateTranslate(input.id, input.value);
    }),
});
