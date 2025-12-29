import {
  CreateNewMessageParamsSchema,
  UpdateMessageParamsSchema,
  UpdateMessagePluginSchema,
  UpdateMessageRAGParamsSchema,
} from '@lobechat/types';
import { z } from 'zod';

import { serverDBEnv } from '@/config/db';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { UserModel } from '@/database/models/user';
import { getServerDB } from '@/database/server';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { MessageService } from '@/server/services/message';

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
      return ctx.messageService.createMessage(input as any);
    }),

  getHeatmaps: messageProcedure.query(async ({ ctx }) => {
    return ctx.messageModel.getHeatmaps();
  }),

  // TODO: 未来这部分方法也需要使用 authedProcedure
  getMessages: publicProcedure
    .input(
      z.object({
        current: z.number().optional(),
        groupId: z.string().nullable().optional(),
        pageSize: z.number().optional(),
        sessionId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.userId) return [];
      const serverDB = await getServerDB();

      const messageModel = new MessageModel(serverDB, ctx.userId);
      const fileService = new FileService(serverDB, ctx.userId);

      return messageModel.query(input, {
        groupAssistantMessages: false,
        postProcessUrl: (path) => fileService.getFullFileUrl(path),
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
      z.object({
        id: z.string(),
        sessionId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...options } = input;
      return ctx.messageService.removeMessage(id, options);
    }),

  removeMessageQuery: messageProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.messageModel.deleteMessageQuery(input.id);
    }),

  removeMessages: messageProcedure
    .input(
      z.object({
        ids: z.array(z.string()),
        sessionId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { ids, ...options } = input;
      return ctx.messageService.removeMessages(ids, options);
    }),

  removeMessagesByAssistant: messageProcedure
    .input(
      z.object({
        groupId: z.string().nullable().optional(),
        sessionId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // 获取用户设置以检查是否需要删除相关文件
      const userModel = new UserModel(ctx.serverDB, ctx.userId);
      const userSettings = await userModel.getUserSettings();
      const shouldDeleteFiles = (userSettings?.general as any)?.deleteTopicFiles || false;

      // 如果需要删除文件，则先收集文件信息
      let filesToDelete: string[] = [];
      if (shouldDeleteFiles) {
        // 获取要删除的消息列表
        const messagesToDelete = await ctx.serverDB.query.messages.findMany({
          where: (messages, { eq, and, isNull }) => {
            const conditions = [eq(messages.userId, ctx.userId)];

            if (input.sessionId) {
              conditions.push(eq(messages.sessionId, input.sessionId));
            } else {
              conditions.push(isNull(messages.sessionId));
            }

            if (input.topicId) {
              conditions.push(eq(messages.topicId, input.topicId));
            } else {
              conditions.push(isNull(messages.topicId));
            }

            if (input.groupId) {
              conditions.push(eq(messages.groupId, input.groupId));
            }

            return and(...conditions);
          },
        });

        const messageIds = messagesToDelete.map((m) => m.id);

        if (messageIds.length > 0) {
          // 获取这些消息关联的文件
          const filesInMessages = await ctx.serverDB.query.messagesFiles.findMany({
            where: (messagesFiles, { inArray, eq, and }) => {
              return and(
                inArray(messagesFiles.messageId, messageIds),
                eq(messagesFiles.userId, ctx.userId),
              );
            },
          });

          const fileIds = [...new Set(filesInMessages.map((f) => f.fileId))];

          if (fileIds.length > 0) {
            // 批量查询所有文件的使用情况
            const messageIdSet = new Set(messageIds);
            const allFileUsage = await ctx.serverDB.query.messagesFiles.findMany({
              where: (messagesFiles, { inArray, eq, and }) => {
                return and(
                  inArray(messagesFiles.fileId, fileIds),
                  eq(messagesFiles.userId, ctx.userId),
                );
              },
            });

            // 按 fileId 分组
            const usageByFile = allFileUsage.reduce(
              (acc, usage) => {
                if (!acc[usage.fileId]) acc[usage.fileId] = [];
                acc[usage.fileId].push(usage);
                return acc;
              },
              {} as Record<string, typeof allFileUsage>,
            );

            // 检查每个文件是否被其他消息使用
            for (const fileId of fileIds) {
              const usages = usageByFile[fileId] || [];
              // 如果文件只被当前要删除的消息使用，则标记删除
              const usedByOtherMessages = usages.some(
                (usage) => !messageIdSet.has(usage.messageId),
              );

              if (!usedByOtherMessages) {
                filesToDelete.push(fileId);
              }
            }
          }
        }
      }

      // 先删除文件（如果有）
      if (filesToDelete.length > 0) {
        const fileModel = new FileModel(ctx.serverDB, ctx.userId);
        const fileService = new FileService(ctx.serverDB, ctx.userId);

        const deletedFiles = await fileModel.deleteMany(
          filesToDelete,
          serverDBEnv.REMOVE_GLOBAL_FILE,
        );

        if (deletedFiles && deletedFiles.length > 0) {
          // deleteFiles 方法会自动处理 URL 到 key 的转换
          await fileService.deleteFiles(
            deletedFiles
              .map((file) => file.url)
              .filter((url): url is string => Boolean(url))
          );
        }
      }

      // 然后删除消息
      return ctx.messageModel.deleteMessagesBySession(
        input.sessionId,
        input.topicId,
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
      z.object({
        id: z.string(),
        sessionId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
        value: UpdateMessageParamsSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, ...options } = input;
      return ctx.messageService.updateMessage(id, value as any, options);
    }),

  updateMessagePlugin: messageProcedure
    .input(
      z.object({
        id: z.string(),
        sessionId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
        value: UpdateMessagePluginSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, ...options } = input;
      return ctx.messageService.updateMessagePlugin(id, value, options);
    }),

  updateMessageRAG: messageProcedure
    .input(
      UpdateMessageRAGParamsSchema.extend({
        sessionId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, ...options } = input;
      return ctx.messageService.updateMessageRAG(id, value, options);
    }),

  updateMetadata: messageProcedure
    .input(
      z.object({
        id: z.string(),
        sessionId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
        value: z.object({}).passthrough(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, ...options } = input;
      return ctx.messageService.updateMetadata(id, value, options);
    }),

  updatePluginError: messageProcedure
    .input(
      z.object({
        id: z.string(),
        sessionId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
        value: z.object({}).passthrough().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, ...options } = input;
      return ctx.messageService.updatePluginError(id, value, options);
    }),

  updatePluginState: messageProcedure
    .input(
      z.object({
        id: z.string(),
        sessionId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
        value: z.object({}).passthrough(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, ...options } = input;
      return ctx.messageService.updatePluginState(id, value, options);
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
