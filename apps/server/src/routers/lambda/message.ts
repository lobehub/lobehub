import {
  CreateNewMessageParamsSchema,
  UpdateMessageParamsSchema,
  UpdateMessagePluginSchema,
  UpdateMessageRAGParamsSchema,
} from '@lobechat/types';
import { createTimingHelpers, createTimingRequestId } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  cloudWorkspaceAuth,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { MessageModel } from '@/database/models/message';
import { TopicShareModel } from '@/database/models/topicShare';
import { CompressionRepository } from '@/database/repositories/compression';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { type MessageBatchOperation, MessageService } from '@/server/services/message';

import { resolveAgentIdFromSession, resolveContext } from './_helpers/resolveContext';
import { basicContextSchema } from './_schema/context';

const { logTiming, runTimedStage } = createTimingHelpers('lobe-server:chat:lobehub:timing');

const messageProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      compressionRepo: new CompressionRepository(ctx.serverDB, ctx.userId, wsId),
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      messageService: new MessageService(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

/**
 * Shared input for the ownership-scoped message analytics queries
 * (count / countByTopic / topicStats). Every field is an optional filter
 * applied on top of the `userId × workspace` ownership predicate.
 */
const messageAnalyticsSchema = z.object({
  agentId: z.string().optional(),
  endDate: z.string().optional(),
  range: z.tuple([z.string(), z.string()]).optional(),
  role: z.string().optional(),
  startDate: z.string().optional(),
  topicId: z.string().optional(),
});

const messageBatchOperationSchema = z.discriminatedUnion('type', [
  z.object({
    message: CreateNewMessageParamsSchema,
    type: z.literal('createMessage'),
  }),
  z.object({
    id: z.string(),
    type: z.literal('updateMessage'),
    value: UpdateMessageParamsSchema,
  }),
  z.object({
    id: z.string(),
    type: z.literal('updateToolMessage'),
    value: z.object({
      content: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      pluginError: z.any().optional(),
      pluginState: z.record(z.string(), z.any()).optional(),
    }),
  }),
]);

export const messageRouter = router({
  addFilesToMessage: messageProcedure
    .use(withScopedPermission('message:update'))
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
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.addFilesToMessage(id, fileIds, resolved);
    }),

  batchMutate: messageProcedure
    .use(withScopedPermission('message:create'))
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        operations: z.array(messageBatchOperationSchema).min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const operations: MessageBatchOperation[] = await Promise.all(
        input.operations.map(async (operation): Promise<MessageBatchOperation> => {
          if (
            operation.type !== 'createMessage' ||
            operation.message.agentId ||
            !operation.message.sessionId
          ) {
            return operation as MessageBatchOperation;
          }

          const agentId = await resolveAgentIdFromSession(
            operation.message.sessionId,
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          );

          return {
            ...operation,
            message: {
              ...operation.message,
              agentId: agentId!,
            },
          } as MessageBatchOperation;
        }),
      );

      return ctx.messageService.batchMutate(operations);
    }),

  /**
   * Cancel compression by deleting the compression group and restoring original messages
   */
  cancelCompression: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        agentId: z.string(),
        groupId: z.string().nullish(),
        messageGroupId: z.string(),
        sourceGroupIds: z.array(z.string()).optional(),
        threadId: z.string().nullish(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { messageGroupId, agentId, groupId, threadId, topicId } = input;

      return ctx.messageService.cancelCompression(messageGroupId, {
        agentId,
        groupId,
        threadId,
        topicId,
      });
    }),

  listAll: messageProcedure
    .input(
      z
        .object({
          current: z.number().optional(),
          pageSize: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.messageModel.queryAll(input);
    }),

  count: messageProcedure.input(messageAnalyticsSchema.optional()).query(async ({ ctx, input }) => {
    return ctx.messageModel.count(input);
  }),

  /**
   * Count messages grouped by topic (server-side GROUP BY), sorted by count
   * desc. Optionally scoped by agent / role / date range.
   */
  countByTopic: messageProcedure
    .input(messageAnalyticsSchema.optional())
    .query(async ({ ctx, input }) => {
      return ctx.messageModel.countGroupByTopic(input);
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

  /**
   * Create a compression group for old messages
   * Creates a placeholder group, marks messages as compressed
   * Returns messages to summarize for frontend AI generation
   */
  createCompressionGroup: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        agentId: z.string(),
        groupId: z.string().nullish(),
        messageIds: z.array(z.string()),
        threadId: z.string().nullish(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { topicId, messageIds, agentId, groupId, threadId } = input;

      return ctx.messageService.createCompressionGroup(topicId, messageIds, {
        agentId,
        groupId,
        threadId,
        topicId,
      });
    }),

  createMessage: messageProcedure
    .use(withScopedPermission('message:create'))
    .input(CreateNewMessageParamsSchema)
    .mutation(async ({ input, ctx }) => {
      // If there's no agentId but has sessionId, resolve agentId from sessionId
      let agentId = input.agentId;
      if (!agentId && input.sessionId) {
        agentId = (await resolveAgentIdFromSession(
          input.sessionId,
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ))!;
      }

      // Create message with the resolved agentId
      return ctx.messageService.createMessage({ ...input, agentId } as any);
    }),

  /**
   * Finalize compression by updating the group with generated summary
   */
  finalizeCompression: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        agentId: z.string(),
        content: z.string(),
        groupId: z.string().nullish(),
        messageGroupId: z.string(),
        threadId: z.string().nullish(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { messageGroupId, content, ...params } = input;

      return ctx.messageService.finalizeCompression(messageGroupId, content, params);
    }),

  getHeatmaps: messageProcedure.query(async ({ ctx }) => {
    return ctx.messageModel.getHeatmaps();
  }),

  getTokenHeatmaps: messageProcedure.query(async ({ ctx }) => {
    return ctx.messageModel.getTokenHeatmaps();
  }),

  getMessages: publicProcedure
    .use(cloudWorkspaceAuth)
    .use(serverDatabase)
    .input(
      z.object({
        agentId: z.string().nullish(),
        current: z.number().optional(),
        groupId: z.string().nullish(),
        pageSize: z.number().optional(),
        sessionId: z.string().nullish(),
        // Mid-stream refetches skip the Work-summary assembly — see
        // `QueryMessageParams.skipWorks`.
        skipWorks: z.boolean().optional(),
        threadId: z.string().nullish(),
        topicId: z.string().nullish(),
        topicShareId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { topicShareId, ...queryParams } = input;

      // Public access via topicShareId
      if (topicShareId) {
        const share = await TopicShareModel.findByShareIdWithAccessCheck(
          ctx.serverDB,
          topicShareId,
          ctx.userId ?? undefined,
        );

        // Workspace shares store their workspaceId on the share record; without
        // it the ownership filter degrades to `workspace_id IS NULL` and returns
        // no messages for workspace topics.
        const shareWorkspaceId = share.workspaceId ?? undefined;
        const messageModel = new MessageModel(ctx.serverDB, share.ownerId, shareWorkspaceId);
        const fileService = new FileService(ctx.serverDB, share.ownerId, shareWorkspaceId);

        return messageModel.query(
          // Force skipWorks: Work summaries join LIVE task/version state (not a
          // share-time snapshot), so serving them here would leak post-share
          // mutations to anonymous visitors. Share pages render no Work chips.
          { ...queryParams, skipWorks: true, topicId: share.topicId },
          {
            postProcessUrl: (path, file) =>
              fileService.getFileAccessUrl({ id: file.id, url: path }),
          },
        );
      }

      // Authenticated access - require userId
      if (!ctx.userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
      }

      const wsId = ctx.workspaceId ?? undefined;
      const messageModel = new MessageModel(ctx.serverDB, ctx.userId, wsId);
      const fileService = new FileService(ctx.serverDB, ctx.userId, wsId);

      return messageModel.query(queryParams, {
        postProcessUrl: (path, file) => fileService.getFileAccessUrl({ id: file.id, url: path }),
      });
    }),

  rankModels: messageProcedure.query(async ({ ctx }) => {
    return ctx.messageModel.rankModels();
  }),

  /**
   * Distribution of message counts per topic (topics / mean / median / p90 /
   * p99 / one-shot ratio + histogram). Aggregated server-side; optionally
   * scoped by agent / role / date range.
   */
  topicStats: messageProcedure
    .input(messageAnalyticsSchema.optional())
    .query(async ({ ctx, input }) => {
      return ctx.messageModel.topicMessageStats(input);
    }),

  removeMessage: messageProcedure
    .use(withScopedPermission('message:delete'))
    .input(
      z
        .object({
          id: z.string(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, agentId, ...options } = input;
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.removeMessage(id, resolved);
    }),

  removeMessageQuery: messageProcedure
    .use(withScopedPermission('message:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.messageModel.deleteMessageQuery(input.id);
    }),

  removeMessages: messageProcedure
    .use(withScopedPermission('message:delete'))
    .input(
      z
        .object({
          ids: z.array(z.string()),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { ids, agentId, ...options } = input;
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.removeMessages(ids, resolved);
    }),

  removeMessagesByAssistant: messageProcedure
    .use(withScopedPermission('message:delete'))
    .input(
      z
        .object({
          groupId: z.string().nullish(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { agentId, ...options } = input;
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageModel.deleteMessagesBySession(
        resolved.sessionId,
        resolved.topicId,
        input.groupId,
      );
    }),

  removeMessagesByGroup: messageProcedure
    .use(withScopedPermission('message:delete'))
    .input(
      z.object({
        groupId: z.string(),
        topicId: z.string().nullish(),
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
    .use(withScopedPermission('message:update'))
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
      const timingContext = { requestId: createTimingRequestId(), startedAt: Date.now() };
      logTiming(timingContext, 'lambda.message.update:start', {
        hasAgentId: !!agentId,
        hasTopicId: !!options.topicId,
        valueKeys: Object.keys(value ?? {}),
      });

      const resolved = await runTimedStage(
        timingContext,
        'lambda.message.update.resolveContext',
        () =>
          resolveContext(
            { agentId, ...options },
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          ),
        { hasAgentId: !!agentId },
      );

      const result = await runTimedStage(
        timingContext,
        'lambda.message.update.service',
        () =>
          ctx.messageService.updateMessage(id, value as any, {
            ...resolved,
            timingRequestId: timingContext.requestId,
            timingStartedAt: timingContext.startedAt,
          }),
        { hasResolvedTopicId: !!resolved.topicId },
      );

      logTiming(timingContext, 'lambda.message.update:done', {
        messageCount: result.messages?.length ?? 0,
        success: result.success,
      });
      return result;
    }),

  /**
   * Update message group metadata (e.g., expanded state)
   */
  updateMessageGroupMetadata: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        context: z.object({
          agentId: z.string(),
          groupId: z.string().nullish(),
          threadId: z.string().nullish(),
          topicId: z.string(),
        }),
        expanded: z.boolean().optional(),
        messageGroupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { messageGroupId, expanded, context } = input;

      return ctx.messageService.updateMessageGroupMetadata(messageGroupId, { expanded }, context);
    }),

  updateMessagePlugin: messageProcedure
    .use(withScopedPermission('message:update'))
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
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updateMessagePlugin(id, value, resolved);
    }),

  updateMessageRAG: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(UpdateMessageRAGParamsSchema.extend(basicContextSchema.shape))
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updateMessageRAG(id, value, resolved);
    }),

  updateMetadata: messageProcedure
    .use(withScopedPermission('message:update'))
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
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updateMetadata(id, value, resolved);
    }),

  updatePluginError: messageProcedure
    .use(withScopedPermission('message:update'))
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
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updatePluginError(id, value, resolved);
    }),

  updatePluginState: messageProcedure
    .use(withScopedPermission('message:update'))
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
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updatePluginState(id, value, resolved);
    }),

  updateTTS: messageProcedure
    .use(withScopedPermission('message:update'))
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
    .use(withScopedPermission('message:update'))
    .input(
      z
        .object({
          toolCallId: z.string(),
          value: z.union([z.string(), z.record(z.string(), z.unknown())]),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { toolCallId, value, agentId, ...options } = input;
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updateToolArguments(toolCallId, value, resolved);
    }),

  /**
   * Update tool message with content, metadata, pluginState, and pluginError in a single transaction
   * This prevents race conditions when updating multiple fields
   */
  updateToolMessage: messageProcedure
    .use(withScopedPermission('message:update'))
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
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updateToolMessage(id, value, resolved);
    }),
  updateTranslate: messageProcedure
    .use(withScopedPermission('message:update'))
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
