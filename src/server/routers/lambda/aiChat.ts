import { randomUUID } from 'node:crypto';

import type {
  CreateMessageParams,
  DBMessageItem,
  SendMessageServerResponse,
  UIChatMessage,
} from '@lobechat/types';
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
const { createPrefixedTimingContext, logTiming, markStageDone, runTimedStage } =
  createTimingHelpers('lobe-server:chat:lobehub:timing');

type SendMessageServerResponseWithPartial = SendMessageServerResponse & {
  __isPartialMessages?: boolean;
};

type CreatedMessageItem = DBMessageItem & {
  editorData?: Record<string, any> | null;
  groupId?: string | null;
  targetId?: string | null;
  usage?: UIChatMessage['usage'] | null;
};

const toCreatedUIChatMessage = ({
  agentId,
  content,
  createdAt,
  editorData,
  error,
  groupId,
  id,
  metadata,
  model,
  observationId,
  parentId,
  provider,
  quotaId,
  reasoning,
  role,
  search,
  sessionId,
  targetId,
  threadId,
  tools,
  topicId,
  traceId,
  updatedAt,
  usage,
}: CreatedMessageItem): UIChatMessage => ({
  agentId: agentId ?? undefined,
  content: content ?? '',
  createdAt: createdAt instanceof Date ? createdAt.getTime() : Date.now(),
  editorData,
  error,
  extra: { model: model ?? undefined, provider: provider ?? undefined },
  groupId: groupId ?? undefined,
  id,
  metadata,
  model,
  observationId: observationId ?? undefined,
  parentId: parentId ?? undefined,
  provider,
  quotaId: quotaId ?? undefined,
  reasoning,
  role: role as UIChatMessage['role'],
  search,
  sessionId: sessionId ?? undefined,
  targetId: targetId ?? undefined,
  threadId,
  tools,
  topicId: topicId ?? undefined,
  traceId: traceId ?? undefined,
  updatedAt: updatedAt instanceof Date ? updatedAt.getTime() : Date.now(),
  usage: usage ?? undefined,
});

const canUseCreatedMessagesFastPath = (input: z.infer<typeof AiSendMessageServerSchema>) =>
  !!input.newTopic &&
  !input.topicId &&
  !input.newTopic.topicMessageIds?.length &&
  !input.newThread &&
  !input.preloadMessages?.length &&
  !input.newUserMessage.files?.length;

const canUseExistingTopicFastPath = (input: z.infer<typeof AiSendMessageServerSchema>) =>
  !!input.topicId &&
  !input.newTopic &&
  !input.newThread &&
  !input.threadId &&
  !input.preloadMessages?.length &&
  !input.newUserMessage.files?.length;

const getUserMessageMetadata = (
  newUserMessage: z.infer<typeof AiSendMessageServerSchema>['newUserMessage'],
) =>
  newUserMessage.metadata || newUserMessage.pageSelections?.length
    ? {
        ...newUserMessage.metadata,
        ...(newUserMessage.pageSelections?.length
          ? { pageSelections: newUserMessage.pageSelections }
          : undefined),
      }
    : undefined;

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

    // Pre-allocate the tracing row id so we can return it to the client even
    // though the actual `service.record()` call happens in Next's `after()`
    // (after the response has been sent). Honour the caller-supplied id when
    // one was passed via `tracing.tracingId` — the schema already validates
    // it as UUID, so a malformed value never reaches here.
    const tracingId = input.tracing?.tracingId ?? randomUUID();

    // Always stamp a trigger on metadata so cross-cutting hooks (timing,
    // routing) and the tracing registry have a fallback when the caller
    // forgets to set one. `tracing` carries the structured tracing config
    // (scenario / promptVersion / schemaName / inputHint / ...).
    const data = await ctx.aiGenerationService.generateObject(
      {
        messages: input.messages,
        model: input.model,
        provider: input.provider,
        schema: input.schema,
        tools: input.tools,
      },
      {
        metadata: { trigger: RequestTrigger.Chat, ...input.metadata },
        tracing: { ...input.tracing, tracingId },
      },
    );

    log('generateObject completed, result: %O', data);
    return { data, tracingId };
  }),

  sendMessageInServer: aiChatProcedure
    .input(AiSendMessageServerSchema)
    .mutation(async ({ input, ctx }) => {
      const timingContext =
        input.newAssistantMessage.provider === 'lobehub'
          ? { requestId: createTimingRequestId(), startedAt: Date.now() }
          : undefined;
      const runServerPersistStage = async <T>(
        stage: string,
        task: () => T | Promise<T>,
        metadata: Record<string, unknown> = {},
      ): Promise<Awaited<T>> => {
        return runTimedStage(timingContext, `lambda.aiChat.${stage}`, task, metadata);
      };
      const logFastPathMessagesAndTopics = (metadata: Record<string, unknown>) => {
        markStageDone(timingContext, 'lambda.aiChat.messagesAndTopics.fastResponse', metadata);
      };
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

      if (canUseCreatedMessagesFastPath(input)) {
        const result = await runServerPersistStage(
          'simpleNewTopicTurn.create',
          () =>
            ctx.aiChatService.createSimpleNewTopicTurn({
              agentId: input.agentId,
              assistantMessage: {
                content: LOADING_FLAT,
                metadata: input.newAssistantMessage.metadata,
                model: input.newAssistantMessage.model,
                provider: input.newAssistantMessage.provider,
              },
              groupId: input.groupId,
              sessionId: input.sessionId,
              topic: {
                metadata: input.newTopic!.metadata,
                title: input.newTopic!.title,
                trigger: input.newTopic!.trigger,
              },
              userMessage: {
                content: input.newUserMessage.content,
                editorData: input.newUserMessage.editorData,
                metadata: getUserMessageMetadata(input.newUserMessage),
              },
            }),
          {
            hasAgentId: !!input.agentId,
            hasGroupId: !!input.groupId,
            hasSessionId: !!input.sessionId,
          },
        );
        const messages = [
          toCreatedUIChatMessage(result.userMessage as CreatedMessageItem),
          toCreatedUIChatMessage(result.assistantMessage as CreatedMessageItem),
        ];

        logFastPathMessagesAndTopics({
          isCreateNewTopic: true,
          messageCount: messages.length,
          reason: 'simple-new-topic-turn',
          topicCount: 0,
        });
        logTiming(timingContext, 'lambda.aiChat.sendMessageInServer:done', {
          isCreateNewTopic: true,
          messageCount: messages.length,
          topicCount: 0,
        });

        const response: SendMessageServerResponseWithPartial = {
          assistantMessageId: result.assistantMessage.id,
          isCreateNewTopic: true,
          messages,
          topicId: result.topicId,
          userMessageId: result.userMessage.id,
        };

        return response;
      }

      if (canUseExistingTopicFastPath(input)) {
        const result = await runServerPersistStage(
          'simpleExistingTopicTurn.create',
          () =>
            ctx.aiChatService.createSimpleExistingTopicTurn({
              agentId: input.agentId,
              assistantMessage: {
                content: LOADING_FLAT,
                metadata: input.newAssistantMessage.metadata,
                model: input.newAssistantMessage.model,
                provider: input.newAssistantMessage.provider,
              },
              groupId: input.groupId,
              sessionId: input.sessionId,
              topicId: input.topicId!,
              userMessage: {
                content: input.newUserMessage.content,
                editorData: input.newUserMessage.editorData,
                metadata: getUserMessageMetadata(input.newUserMessage),
                parentId: input.newUserMessage.parentId,
              },
            }),
          {
            hasAgentId: !!input.agentId,
            hasGroupId: !!input.groupId,
            hasParentId: !!input.newUserMessage.parentId,
            hasSessionId: !!input.sessionId,
            topicId: input.topicId,
          },
        );
        const messages = [
          toCreatedUIChatMessage(result.userMessage as CreatedMessageItem),
          toCreatedUIChatMessage(result.assistantMessage as CreatedMessageItem),
        ];

        logFastPathMessagesAndTopics({
          isCreateNewTopic: false,
          messageCount: messages.length,
          reason: 'simple-existing-topic-turn',
          topicCount: 0,
        });
        logTiming(timingContext, 'lambda.aiChat.sendMessageInServer:done', {
          isCreateNewTopic: false,
          messageCount: messages.length,
          topicCount: 0,
        });

        const response: SendMessageServerResponseWithPartial = {
          __isPartialMessages: true,
          assistantMessageId: result.assistantMessage.id,
          isCreateNewTopic: false,
          messages,
          topicId: result.topicId,
          userMessageId: result.userMessage.id,
        };

        return response;
      }

      let sessionId = input.sessionId;
      if (!sessionId) {
        const context = await runServerPersistStage(
          'resolveContext',
          () => resolveContext(input, ctx.serverDB, ctx.userId),
          { hasAgentId: !!input.agentId },
        );
        if (!!context.sessionId) sessionId = context.sessionId;
      }

      let topicId = input.topicId!;
      let threadId = input.threadId;
      let createdThreadId: string | undefined;

      let isCreateNewTopic = false;

      // create topic if there should be a new topic
      if (input.newTopic) {
        log('creating new topic with title: %s', input.newTopic.title);
        const topicItem = await runServerPersistStage(
          'topic.create',
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
          void runServerPersistStage(
            'agent.touchUpdatedAt',
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
        const threadItem = await runServerPersistStage(
          'thread.create',
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

        parentId = await runServerPersistStage(
          'preloadMessages.create',
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
      const userMessageMetadata = getUserMessageMetadata(input.newUserMessage);

      const createMessagePairPromise = runServerPersistStage(
        'messages.createUserAndAssistant',
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
        await createMessagePairPromise;

      const messageId = userMessageItem.id;
      log('user message created with id: %s', messageId);

      log('assistant message created with id: %s', assistantMessageItem.id);

      // retrieve latest messages and topic with
      log('retrieving messages and topics');
      const { messages, topics } = await runServerPersistStage(
        'messagesAndTopics.query',
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

      const response: SendMessageServerResponseWithPartial = {
        assistantMessageId: assistantMessageItem.id,
        createdThreadId,
        isCreateNewTopic,
        messages,
        topicId,
        topics: topics as SendMessageServerResponse['topics'],
        userMessageId: messageId,
      };

      return response;
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
