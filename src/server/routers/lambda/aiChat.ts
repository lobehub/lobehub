import type { CreateMessageParams, SendMessageServerResponse } from '@lobechat/types';
import { AiSendMessageServerSchema, RequestTrigger, StructureOutputSchema } from '@lobechat/types';
import { createTimingHelpers, createTimingRequestId } from '@lobechat/utils';
import debug from 'debug';
import { z } from 'zod';

import { LOADING_FLAT } from '@/const/message';
import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { resolveContext } from '@/server/routers/lambda/_helpers/resolveContext';
import { AiChatService } from '@/server/services/aiChat';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { FileService } from '@/server/services/file';
import { archiveToolResultIfNeeded } from '@/server/services/toolExecution/archiveToolResult';

const log = debug('lobe-lambda-router:ai-chat');
const { createPrefixedTimingContext, logTiming, runTimedStage } = createTimingHelpers(
  'lobe-server:chat:lobehub:timing',
);

const aiChatProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId),
      aiChatService: new AiChatService(ctx.serverDB, ctx.userId),
      aiGenerationService: new AiGenerationService(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const aiChatRouter = router({
  outputJSON: aiChatProcedure.input(StructureOutputSchema).mutation(async ({ input, ctx }) => {
    log('outputJSON called with provider: %s, model: %s', input.provider, input.model);
    log('messages count: %d', input.messages.length);
    log('schema: %O', input.schema);

    // Always stamp a trigger on metadata so cross-cutting hooks (timing,
    // routing) and the tracing registry have a fallback when the caller
    // forgets to set one. `tracing` carries the structured tracing config
    // (scenario / promptVersion / schemaName / inputHint / ...).
    const result = await ctx.aiGenerationService.generateObject(
      {
        messages: input.messages,
        model: input.model,
        provider: input.provider,
        schema: input.schema,
        tools: input.tools,
      },
      {
        metadata: { trigger: RequestTrigger.Chat, ...input.metadata },
        tracing: input.tracing,
      },
    );

    log('generateObject completed, result: %O', result);
    return result;
  }),

  sendMessageInServer: aiChatProcedure
    .input(AiSendMessageServerSchema)
    .mutation(async ({ input, ctx }) => {
      const timingContext =
        input.newAssistantMessage.provider === 'lobehub'
          ? { requestId: createTimingRequestId(), startedAt: Date.now() }
          : undefined;
      logTiming(timingContext, 'lambda.aiChat.sendMessageInServer:start', {
        hasNewThread: !!input.newThread,
        hasNewTopic: !!input.newTopic,
        hasSessionId: !!input.sessionId,
        hasTopicId: !!input.topicId,
        preloadCount: input.preloadMessages?.length ?? 0,
      });
      log('sendMessageInServer called for agentId: %s', input.agentId);
      log(
        'topicId: %s, newTopic: %O, newThread: %O',
        input.topicId,
        input.newTopic,
        input.newThread,
      );
      let sessionId = input.sessionId;
      if (!sessionId) {
        const context = await runTimedStage(
          timingContext,
          'lambda.aiChat.resolveContext',
          () => resolveContext(input, ctx.serverDB, ctx.userId),
          { hasAgentId: !!input.agentId },
        );
        if (!!context.sessionId) sessionId = context.sessionId;
      }

      let topicId = input.topicId!;
      let threadId = input.threadId;
      let createdThreadId: string | undefined;

      let isCreateNewTopic = false;
      let agentTouchUpdatedAtTask: Promise<void> | undefined;

      // create topic if there should be a new topic
      if (input.newTopic) {
        log('creating new topic with title: %s', input.newTopic.title);
        const topicItem = await runTimedStage(
          timingContext,
          'lambda.aiChat.topic.create',
          () => {
            const payload = {
              agentId: input.agentId,
              groupId: input.groupId,
              messages: input.newTopic!.topicMessageIds,
              metadata: input.newTopic!.metadata,
              sessionId,
              title: input.newTopic!.title,
              trigger: input.newTopic!.trigger,
            };
            const modelTiming = createPrefixedTimingContext(
              timingContext,
              'lambda.aiChat.topic.create',
            );
            return modelTiming
              ? ctx.topicModel.create(payload, undefined, modelTiming)
              : ctx.topicModel.create(payload);
          },
          {
            messageCount: input.newTopic.topicMessageIds?.length ?? 0,
            trigger: input.newTopic.trigger,
          },
        );
        topicId = topicItem.id;
        isCreateNewTopic = true;
        log('new topic created with id: %s', topicId);

        // update agent's updatedAt to reflect new activity
        if (input.agentId) {
          agentTouchUpdatedAtTask = runTimedStage(
            timingContext,
            'lambda.aiChat.agent.touchUpdatedAt',
            async () => {
              await ctx.agentModel.touchUpdatedAt(input.agentId!);
            },
            { hasAgentId: true },
          ).catch((error) => {
            console.error('[aiChat] Failed to touch agent updatedAt:', error);
          });
          log('agent updatedAt touch scheduled for agentId: %s', input.agentId);
        }
      }

      // create thread if there should be a new thread
      if (input.newThread) {
        log(
          'creating new thread with sourceMessageId: %s, type: %s',
          input.newThread.sourceMessageId,
          input.newThread.type,
        );
        const threadItem = await runTimedStage(
          timingContext,
          'lambda.aiChat.thread.create',
          () =>
            ctx.threadModel.create({
              parentThreadId: input.newThread!.parentThreadId,
              sourceMessageId: input.newThread!.sourceMessageId,
              title: input.newThread!.title,
              topicId,
              type: input.newThread!.type,
            }),
          { threadType: input.newThread.type },
        );
        if (threadItem) {
          threadId = threadItem.id;
          createdThreadId = threadItem.id;
          log('new thread created with id: %s', threadId);
        }
      }

      let parentId = input.newUserMessage.parentId;

      if (input.preloadMessages?.length) {
        log('creating %d preload messages before user message', input.preloadMessages.length);

        parentId = await runTimedStage(
          timingContext,
          'lambda.aiChat.preloadMessages.create',
          async () => {
            let latestParentId = parentId;
            for (const preloadMessage of input.preloadMessages!) {
              const payload = {
                agentId: input.agentId,
                content: preloadMessage.content,
                groupId: input.groupId,
                metadata: preloadMessage.metadata,
                parentId: latestParentId,
                plugin: preloadMessage.plugin as CreateMessageParams['plugin'],
                role: preloadMessage.role,
                sessionId,
                threadId,
                tool_call_id: preloadMessage.tool_call_id,
                tools: preloadMessage.tools as CreateMessageParams['tools'],
                topicId,
              };
              const modelTiming = createPrefixedTimingContext(
                timingContext,
                'lambda.aiChat.preloadMessages.create',
              );
              const preloadItem = await (modelTiming
                ? ctx.messageModel.create(payload, undefined, modelTiming)
                : ctx.messageModel.create(payload));

              latestParentId = preloadItem.id;
            }
            return latestParentId;
          },
          { count: input.preloadMessages.length },
        );
      }

      // create user message
      log('creating user message with content length: %d', input.newUserMessage.content.length);

      // Build user message metadata with pageSelections if present
      const userMessageMetadata =
        input.newUserMessage.metadata || input.newUserMessage.pageSelections?.length
          ? {
              ...input.newUserMessage.metadata,
              ...(input.newUserMessage.pageSelections?.length
                ? { pageSelections: input.newUserMessage.pageSelections }
                : undefined),
            }
          : undefined;

      const createMessagePairPromise = runTimedStage(
        timingContext,
        'lambda.aiChat.messages.createUserAndAssistant',
        () => {
          const userMessage = {
            agentId: input.agentId,
            content: input.newUserMessage.content,
            editorData: input.newUserMessage.editorData,
            files: input.newUserMessage.files,
            groupId: input.groupId,
            metadata: userMessageMetadata,
            parentId,
            role: 'user',
            sessionId,
            threadId,
            topicId,
          } satisfies CreateMessageParams;
          const assistantMessage = {
            agentId: input.agentId,
            content: LOADING_FLAT,
            groupId: input.groupId,
            metadata: input.newAssistantMessage.metadata,
            model: input.newAssistantMessage.model,
            provider: input.newAssistantMessage.provider,
            role: 'assistant',
            sessionId,
            threadId,
            topicId,
          } satisfies CreateMessageParams;
          const modelTiming = createPrefixedTimingContext(
            timingContext,
            'lambda.aiChat.messages.createUserAndAssistant',
          );
          return ctx.messageModel.createUserAndAssistantMessages(
            { assistantMessage, userMessage },
            {
              ...(modelTiming ? { timing: modelTiming } : {}),
              touchTopicUpdatedAt: !isCreateNewTopic,
            },
          );
        },
        {
          contentLength: input.newUserMessage.content.length,
          fileCount: input.newUserMessage.files?.length ?? 0,
          model: input.newAssistantMessage.model,
          provider: input.newAssistantMessage.provider,
        },
      );
      const { assistantMessage: assistantMessageItem, userMessage: userMessageItem } =
        agentTouchUpdatedAtTask
          ? (await Promise.all([createMessagePairPromise, agentTouchUpdatedAtTask]))[0]
          : await createMessagePairPromise;

      const messageId = userMessageItem.id;
      log('user message created with id: %s', messageId);

      log('assistant message created with id: %s', assistantMessageItem.id);

      // retrieve latest messages and topic with
      log('retrieving messages and topics');
      const { messages, topics } = await runTimedStage(
        timingContext,
        'lambda.aiChat.messagesAndTopics.query',
        () =>
          ctx.aiChatService.getMessagesAndTopics({
            agentId: input.agentId,
            groupId: input.groupId,
            includeTopic: isCreateNewTopic,
            sessionId,
            threadId,
            topicFilter: input.topicFilter,
            topicId,
            topicPageSize: input.topicPageSize,
            ...(timingContext
              ? {
                  timingRequestId: timingContext.requestId,
                  timingStartedAt: timingContext.startedAt,
                }
              : {}),
          }),
        { includeTopic: isCreateNewTopic },
      );

      log('retrieved %d messages, %d topics', messages.length, topics?.items?.length ?? 0);
      logTiming(timingContext, 'lambda.aiChat.sendMessageInServer:done', {
        isCreateNewTopic,
        messageCount: messages.length,
        topicCount: topics?.items?.length ?? 0,
      });

      return {
        assistantMessageId: assistantMessageItem.id,
        createdThreadId,
        isCreateNewTopic,
        messages,
        topicId,
        topics,
        userMessageId: messageId,
      } as SendMessageServerResponse;
    }),

  archiveToolResult: aiChatProcedure
    .input(
      z.object({
        agentId: z.string().nullish(),
        content: z.string(),
        identifier: z.string().optional(),
        limit: z.number().optional(),
        toolCallId: z.string(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return archiveToolResultIfNeeded({
        ...input,
        serverDB: ctx.serverDB,
        userId: ctx.userId,
      });
    }),
});
