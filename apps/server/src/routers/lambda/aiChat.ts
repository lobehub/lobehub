import { randomUUID } from 'node:crypto';

import { TRACING_SCENARIOS } from '@lobechat/const';
import { getErrorCodeSpec } from '@lobechat/model-runtime';
import type { CreateMessageParams, SendMessageServerResponse } from '@lobechat/types';
import { AiSendMessageServerSchema, RequestTrigger, StructureOutputSchema } from '@lobechat/types';
import { createTimingHelpers, createTimingRequestId } from '@lobechat/utils';
import { pickNonEmptyString, toRecord } from '@lobechat/utils/object';
import { TRPCError } from '@trpc/server';
import { getStatusKeyFromCode } from '@trpc/server/unstable-core-do-not-import';
import debug from 'debug';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { LOADING_FLAT } from '@/const/message';
import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { markSilentTRPCErrorLog } from '@/libs/trpc/utils/errorLogger';
import { resolveContext } from '@/server/routers/lambda/_helpers/resolveContext';
import { AiChatService } from '@/server/services/aiChat';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { FileService } from '@/server/services/file';
import { archiveToolResultIfNeeded } from '@/server/services/toolExecution/archiveToolResult';

const log = debug('lobe-lambda-router:ai-chat');
const { createPrefixedTimingContext, logTiming, runTimedStage } = createTimingHelpers(
  'lobe-server:chat:lobehub:timing',
);
type TRPCErrorCode = ConstructorParameters<typeof TRPCError>[0]['code'];
type TRPCStatusCode = Parameters<typeof getStatusKeyFromCode>[0];

const getRuntimeErrorType = (error: unknown): number | string | undefined => {
  if (!error || typeof error !== 'object') return;

  const errorType = (error as { errorType?: unknown }).errorType;
  return typeof errorType === 'number' || typeof errorType === 'string' ? errorType : undefined;
};

const getTRPCErrorCodeFromStatus = (status: number): TRPCErrorCode => {
  const code = getStatusKeyFromCode(status as TRPCStatusCode) as TRPCErrorCode;
  if (code !== 'INTERNAL_SERVER_ERROR') return code;

  return status >= 400 && status < 500 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR';
};

const getRuntimeErrorMessage = (error: unknown): string | undefined => {
  const errorRecord = toRecord(error);
  if (!errorRecord) return;

  return (
    pickNonEmptyString(errorRecord.message) ??
    pickNonEmptyString(toRecord(errorRecord.error)?.message) ??
    pickNonEmptyString(errorRecord.errorMessage)
  );
};

const createRuntimeTRPCError = (
  error: unknown,
  options?: { silentHandlerLog?: boolean },
): TRPCError | undefined => {
  const errorType = getRuntimeErrorType(error);
  const runtimeStatus =
    typeof errorType === 'number'
      ? errorType >= 400 && errorType <= 599
        ? errorType
        : undefined
      : getErrorCodeSpec(errorType)?.httpStatus;
  if (runtimeStatus) {
    if (options?.silentHandlerLog && runtimeStatus < 500) markSilentTRPCErrorLog(error);

    return new TRPCError({
      cause: error,
      code: getTRPCErrorCodeFromStatus(runtimeStatus),
      message:
        typeof errorType === 'string'
          ? errorType
          : (getRuntimeErrorMessage(error) ?? `Request failed (${runtimeStatus})`),
    });
  }

  // Raw provider SDK errors (OpenAI/Anthropic APIError) carry an HTTP status
  // but no errorType — the generateObject path rethrows upstream errors
  // verbatim. Without this mapping, tRPC classifies them as
  // INTERNAL_SERVER_ERROR, so a user-channel 4xx (e.g. a BYOK provider
  // rejecting the request) pollutes server 500 monitoring.
  const status = (error as { status?: unknown } | undefined)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    if (options?.silentHandlerLog) markSilentTRPCErrorLog(error);

    return new TRPCError({
      cause: error,
      code: getTRPCErrorCodeFromStatus(status),
      message: error instanceof Error ? error.message : `Provider error (${status})`,
    });
  }

  return undefined;
};

const aiChatProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      aiChatService: new AiChatService(ctx.serverDB, ctx.userId, wsId),
      aiGenerationService: new AiGenerationService(ctx.serverDB, ctx.userId, wsId),
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

const aiChatWriteProcedure = aiChatProcedure.use(withScopedPermission('message:create'));

export const aiChatRouter = router({
  outputJSON: aiChatWriteProcedure.input(StructureOutputSchema).mutation(async ({ input, ctx }) => {
    log('outputJSON called with provider: %s, model: %s', input.provider, input.model);
    log('messages count: %d', input.messages.length);
    log('schema: %O', input.schema);

    // Pre-allocate the tracing row id so we can return it to the client even
    // though the actual `service.record()` call happens after the response has
    // been sent. Honour the caller-supplied id when
    // one was passed via `tracing.tracingId` — the schema already validates
    // it as UUID, so a malformed value never reaches here.
    const tracingId = input.tracing?.tracingId ?? randomUUID();

    // Always stamp a trigger on metadata so cross-cutting hooks (timing,
    // routing) and the tracing registry have a fallback when the caller
    // forgets to set one. `tracing` carries the structured tracing config
    // (scenario / promptVersion / schemaName / inputHint / ...).
    let data: unknown;
    try {
      data = await ctx.aiGenerationService.generateObject(
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
    } catch (error) {
      const runtimeTRPCError = createRuntimeTRPCError(error, {
        silentHandlerLog: input.tracing?.scenario === TRACING_SCENARIOS.InputCompletion,
      });
      if (runtimeTRPCError) throw runtimeTRPCError;

      throw error;
    }

    log('generateObject completed, result: %O', data);
    return { data, tracingId };
  }),

  sendMessageInServer: aiChatWriteProcedure
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
          () => resolveContext(input, ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
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
              model: input.newTopic!.model,
              provider: input.newTopic!.provider,
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

      // Server-authoritative parent resolution (concurrent-append race fix).
      //
      // The client derives parentId from a local snapshot of the conversation
      // tail, but that tail can advance server-side without the client knowing
      // — e.g. another assistant turn is persisted while the user is composing
      // or right as they hit send. Trusting the client's stale parentId forks
      // the new user turn off an earlier node instead of the real head, which
      // splits the conversation.
      //
      // For a plain append to an existing topic we re-read the spine head from
      // the DB so the message attaches after the latest assistant turn. Note we
      // anchor on the spine head (latest non-tool, non-signal message), NOT the
      // raw latest row: tool results are inline children of their assistant
      // turn, so a new user turn parents off the assistant, never a tool result.
      // A brand-new topic (no prior messages) or a brand-new thread (must anchor
      // on its explicit branch point / sourceMessageId) keep the client parentId.
      //
      // Fall back to the client parentId when the spine head is absent (no spine
      // message yet), so we never orphan the turn by overwriting it to undefined.
      if (topicId && !input.newTopic && !input.newThread) {
        const resolvedParentId = await runTimedStage(
          timingContext,
          'lambda.aiChat.resolveParentId',
          () => ctx.messageModel.getLatestSpineMessageId({ threadId, topicId }),
          { hasThreadId: !!threadId },
        );
        parentId = resolvedParentId ?? parentId;
      }

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

      // Build user message metadata with attached context selections if present.
      const userMessageMetadata =
        input.newUserMessage.metadata ||
        input.newUserMessage.contextSelections?.length ||
        input.newUserMessage.pageSelections?.length
          ? {
              ...input.newUserMessage.metadata,
              ...(input.newUserMessage.contextSelections?.length
                ? { contextSelections: input.newUserMessage.contextSelections }
                : undefined),
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
        workspaceId: ctx.workspaceId ?? undefined,
      });
    }),
});
