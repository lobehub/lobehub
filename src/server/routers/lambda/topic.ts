import { CodeInterpreterResponse } from '@lobechat/types';
import { z } from 'zod';

import { serverDBEnv } from '@/config/db';
import { FileModel } from '@/database/models/file';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { getServerDB } from '@/database/server';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { BatchTaskResult } from '@/types/service';

// Code Interpreter 插件标识符
const CODE_INTERPRETER_IDENTIFIER = 'lobe-code-interpreter';

const topicProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: { topicModel: new TopicModel(ctx.serverDB, ctx.userId) },
  });
});

export const topicRouter = router({
  batchCreateTopics: topicProcedure
    .input(
      z.array(
        z.object({
          favorite: z.boolean().optional(),
          id: z.string().optional(),
          messages: z.array(z.string()).optional(),
          sessionId: z.string().optional(),
          title: z.string(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }): Promise<BatchTaskResult> => {
      const data = await ctx.topicModel.batchCreate(
        input.map((item) => ({
          ...item,
        })) as any,
      );

      return { added: data.length, ids: [], skips: [], success: true };
    }),

  batchDelete: topicProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.batchDelete(input.ids);
    }),

  batchDeleteBySessionId: topicProcedure
    .input(z.object({ id: z.string().nullable().optional() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.batchDeleteBySessionId(input.id);
    }),

  cloneTopic: topicProcedure
    .input(z.object({ id: z.string(), newTitle: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.topicModel.duplicate(input.id, input.newTitle);

      return data.topic.id;
    }),

  countTopics: topicProcedure
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
      return ctx.topicModel.count(input);
    }),

  createTopic: topicProcedure
    .input(
      z.object({
        favorite: z.boolean().optional(),
        groupId: z.string().nullable().optional(),
        messages: z.array(z.string()).optional(),
        sessionId: z.string().nullable().optional(),
        title: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.topicModel.create(input);

      return data.id;
    }),

  getAllTopics: topicProcedure.query(async ({ ctx }) => {
    return ctx.topicModel.queryAll();
  }),

  // TODO: this procedure should be used with authedProcedure
  getTopics: publicProcedure
    .input(
      z.object({
        containerId: z.string().nullable().optional(),
        current: z.number().optional(),
        pageSize: z.number().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.userId) return [];

      const serverDB = await getServerDB();
      const topicModel = new TopicModel(serverDB, ctx.userId);

      return topicModel.query(input);
    }),

  hasTopics: topicProcedure.query(async ({ ctx }) => {
    return (await ctx.topicModel.count()) === 0;
  }),

  rankTopics: topicProcedure.input(z.number().optional()).query(async ({ ctx, input }) => {
    return ctx.topicModel.rank(input);
  }),

  removeAllTopics: topicProcedure.mutation(async ({ ctx }) => {
    return ctx.topicModel.deleteAll();
  }),

  removeTopic: topicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const topicId = input.id;

      // 获取用户设置以检查是否需要删除相关文件
      const userModel = new UserModel(ctx.serverDB, ctx.userId);
      const userSettings = await userModel.getUserSettings();
      const shouldDeleteFiles = (userSettings?.general as any)?.deleteTopicFiles || false;

      // 如果需要删除文件，先获取话题关联的文件ID并检查使用情况
      let filesToDelete: string[] = [];
      if (shouldDeleteFiles) {
        // 获取当前话题的所有消息
        const topicMessages = await ctx.serverDB.query.messages.findMany({
          where: (messages, { eq, and }) => {
            return and(eq(messages.topicId, topicId), eq(messages.userId, ctx.userId));
          },
        });
        const topicMessageIds = new Set(topicMessages.map((m) => m.id));

        // 1. 获取 messages_files 关联的文件 ID
        const fileIdsInTopic = await ctx.topicModel.getTopicFileIds(topicId);

        if (fileIdsInTopic.length > 0) {
          // 批量查询所有文件的使用情况
          const allFileUsage = await ctx.serverDB.query.messagesFiles.findMany({
            where: (messagesFiles, { inArray, eq, and }) => {
              return and(
                inArray(messagesFiles.fileId, fileIdsInTopic),
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

          // 检查每个文件是否被其他话题的消息使用
          for (const fileId of fileIdsInTopic) {
            const usages = usageByFile[fileId] || [];
            const usedByOtherTopics = usages.some((usage) => !topicMessageIds.has(usage.messageId));

            // 如果文件没有被其他话题使用，标记删除
            if (!usedByOtherTopics) {
              filesToDelete.push(fileId);
            }
          }
        }

        // 2. 获取 Code Interpreter 插件生成的文件 ID（存储在消息 content JSON 中）
        const messageIds = topicMessages.map((m) => m.id);
        if (messageIds.length > 0) {
          // 批量获取所有消息的 plugin 信息
          const plugins = await ctx.serverDB.query.messagePlugins.findMany({
            where: (messagePlugins, { inArray }) => inArray(messagePlugins.id, messageIds),
          });

          const pluginMap = new Map(plugins.map((p) => [p.id, p]));

          for (const message of topicMessages) {
            const plugin = pluginMap.get(message.id);

            // 检查是否为 Code Interpreter 插件
            if (plugin?.identifier === CODE_INTERPRETER_IDENTIFIER && message.content) {
              try {
                const result: CodeInterpreterResponse = JSON.parse(message.content);
                if (result.files) {
                  for (const file of result.files) {
                    if (file.fileId && !filesToDelete.includes(file.fileId)) {
                      filesToDelete.push(file.fileId);
                    }
                  }
                }
              } catch {
                // 解析失败则跳过
              }
            }
          }
        }
      }

      // 如果有仅属于该主题的文件，则先删除它们
      if (filesToDelete.length > 0) {
        const fileModel = new FileModel(ctx.serverDB, ctx.userId);
        const fileService = new FileService(ctx.serverDB, ctx.userId);

        const deletedFiles = await fileModel.deleteMany(
          filesToDelete,
          serverDBEnv.REMOVE_GLOBAL_FILE,
        );

        // 从文件存储中删除文件
        if (deletedFiles && deletedFiles.length > 0) {
          // deleteFiles 方法会自动处理 URL 到 key 的转换
          await fileService.deleteFiles(
            deletedFiles
              .map((file) => file.url)
              .filter((url): url is string => Boolean(url))
          );
        }
      }

      // 删除主题本身（这将级联删除消息）
      await ctx.topicModel.delete(topicId);
    }),

  searchTopics: topicProcedure
    .input(
      z.object({
        groupId: z.string().nullable().optional(),
        keywords: z.string(),
        sessionId: z.string().nullable().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.topicModel.queryByKeyword(input.keywords, input.sessionId);
    }),

  updateTopic: topicProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          favorite: z.boolean().optional(),
          historySummary: z.string().optional(),
          messages: z.array(z.string()).optional(),
          metadata: z
            .object({
              model: z.string().optional(),
              provider: z.string().optional(),
            })
            .optional(),
          sessionId: z.string().optional(),
          title: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.update(input.id, input.value);
    }),
});

export type TopicRouter = typeof topicRouter;
