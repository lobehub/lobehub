import {
  type AgentEvent,
  type AgentInstructionCompressContext,
  type GeneralAgentCompressionResultPayload,
  type InstructionExecutor,
  UsageCounter,
} from '@lobechat/agent-runtime';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import { chainCompressContext } from '@lobechat/prompts';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { MessageService } from '@/server/services/message';

import { type RuntimeExecutorContext } from '../context';
import { buildPostProcessUrl, log } from '../executorHelpers';

export const compressContext =
  (ctx: RuntimeExecutorContext): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as AgentInstructionCompressContext;
    const { messages, currentTokenCount } = payload;
    const { operationId, stepIndex } = ctx;
    const operationLogId = `${operationId}:${stepIndex}`;
    const stagePrefix = `[${operationLogId}][compress_context]`;
    const events: AgentEvent[] = [];
    const newState = structuredClone(state);
    const topicId = state.metadata?.topicId;
    const lastMessage = messages.at(-1);
    const preservedMessages =
      messages.length > 1 && lastMessage?.role === 'user' ? [lastMessage] : [];
    const preservedMessageIds = new Set(
      preservedMessages.map((message) => message.id).filter((id): id is string => Boolean(id)),
    );
    const messagesToCompress = preservedMessages.length > 0 ? messages.slice(0, -1) : messages;
    const compressedMessagesFallback = [...messagesToCompress, ...preservedMessages];

    if (!topicId || !ctx.userId) {
      return {
        events,
        newState,
        nextContext: {
          payload: {
            compressedMessages: compressedMessagesFallback,
            groupId: '',
            parentMessageId: undefined,
            skipped: true,
          } as GeneralAgentCompressionResultPayload,
          phase: 'compression_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        },
      };
    }

    if (ctx.hookDispatcher) {
      ctx.hookDispatcher
        .dispatch(
          operationId,
          'beforeCompact',
          {
            messageCount: messagesToCompress.length,
            operationId,
            stepIndex,
            tokenCount: currentTokenCount,
            userId: ctx.userId,
          },
          state.metadata?._hooks,
        )
        .catch(() => {});
    }

    try {
      const dbMessages = await ctx.messageModel.query(
        {
          agentId: state.metadata?.agentId,
          // Group runs need groupId or the query filters `groupId IS NULL` and
          // returns no group messages (here the compression candidate set).
          groupId: state.metadata?.groupId,
          threadId: state.metadata?.threadId,
          topicId,
        },
        { postProcessUrl: buildPostProcessUrl(ctx) },
      );

      const messageIds = dbMessages
        .filter(
          (message) =>
            message.role !== 'compressedGroup' &&
            Boolean(message.id) &&
            !preservedMessageIds.has(message.id),
        )
        .map((message) => message.id);

      if (messageIds.length === 0 || messagesToCompress.length === 0) {
        return {
          events,
          newState,
          nextContext: {
            payload: {
              compressedMessages: compressedMessagesFallback,
              groupId: '',
              parentMessageId: undefined,
              skipped: true,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: newState.messages.length,
              sessionId: operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          },
        };
      }

      const latestAssistantMessage = dbMessages.findLast((message) => message.role === 'assistant');
      const messageService = new MessageService(
        ctx.serverDB,
        ctx.userId,
        state.metadata?.workspaceId ?? ctx.workspaceId,
      );
      const compressionResult = await messageService.createCompressionGroup(topicId, messageIds, {
        agentId: state.metadata?.agentId,
        threadId: state.metadata?.threadId,
        topicId,
      });

      const compressionModel =
        newState.modelRuntimeConfig?.compressionModel || newState.modelRuntimeConfig;

      if (!compressionModel?.model || !compressionModel?.provider) {
        return {
          events,
          newState,
          nextContext: {
            payload: {
              compressedMessages: compressedMessagesFallback,
              groupId: '',
              parentMessageId: latestAssistantMessage?.id,
              skipped: true,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: newState.messages.length,
              sessionId: operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          },
        };
      }

      const compressionPayload = chainCompressContext(compressionResult.messagesToSummarize);
      const compressionRuntime = await initModelRuntimeFromDB(
        ctx.serverDB,
        ctx.userId,
        compressionModel.provider,
        ctx.workspaceId,
      );

      let summaryContent = '';
      let summaryUsage: any;
      let summaryError: any;

      const compressionResponse = await compressionRuntime.chat(
        {
          messages: compressionPayload.messages!,
          model: compressionModel.model,
          stream: true,
        },
        {
          callback: {
            onCompletion: async (data) => {
              if (data.usage) summaryUsage = data.usage;
            },
            onError: async (errorData) => {
              summaryError = errorData;
            },
            onText: async (text) => {
              summaryContent += text;
            },
          },
          user: ctx.userId,
        },
      );

      await consumeStreamUntilDone(compressionResponse);

      if (summaryError) {
        throw new Error(
          typeof summaryError.message === 'string'
            ? summaryError.message
            : JSON.stringify(summaryError),
        );
      }

      const finalCompression = await messageService.finalizeCompression(
        compressionResult.messageGroupId,
        summaryContent,
        {
          agentId: state.metadata?.agentId,
          threadId: state.metadata?.threadId,
          topicId,
        },
      );

      const compressedMessagesBase =
        finalCompression.messages || compressionResult.messagesToSummarize;
      const compressedMessages = [...compressedMessagesBase];

      for (const preservedMessage of preservedMessages) {
        if (
          !compressedMessages.some(
            (message) =>
              message === preservedMessage ||
              (Boolean(message.id) &&
                Boolean(preservedMessage.id) &&
                message.id === preservedMessage.id),
          )
        ) {
          compressedMessages.push(preservedMessage);
        }
      }

      newState.messages = compressedMessages;

      if (summaryUsage) {
        const { usage, cost } = UsageCounter.accumulateLLM({
          cost: newState.cost,
          model: compressionModel.model,
          modelUsage: summaryUsage,
          provider: compressionModel.provider,
          usage: newState.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;
      }

      events.push({
        groupId: compressionResult.messageGroupId,
        parentMessageId: latestAssistantMessage?.id,
        type: 'compression_complete',
      });

      if (ctx.hookDispatcher) {
        ctx.hookDispatcher
          .dispatch(
            operationId,
            'afterCompact',
            {
              groupId: compressionResult.messageGroupId,
              messagesAfter: compressedMessages.length,
              messagesBefore: messagesToCompress.length,
              operationId,
              stepIndex,
              summary: summaryContent.slice(0, 500),
              userId: ctx.userId,
            },
            state.metadata?._hooks,
          )
          .catch(() => {});
      }

      return {
        events,
        newState,
        nextContext: {
          payload: {
            compressedMessages,
            groupId: compressionResult.messageGroupId,
            parentMessageId: latestAssistantMessage?.id,
          } as GeneralAgentCompressionResultPayload,
          phase: 'compression_result',
          session: {
            messageCount: compressedMessages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        },
      };
    } catch (error) {
      log(
        `${stagePrefix} Compression failed. originalTokens=%d error=%O`,
        currentTokenCount,
        error,
      );

      if (ctx.hookDispatcher) {
        ctx.hookDispatcher
          .dispatch(
            operationId,
            'onCompactError',
            {
              error: error instanceof Error ? error.message : String(error),
              operationId,
              stepIndex,
              tokenCount: currentTokenCount,
              userId: ctx.userId,
            },
            state.metadata?._hooks,
          )
          .catch(() => {});
      }

      events.push({ error, type: 'compression_error' });

      return {
        events,
        newState,
        nextContext: {
          payload: {
            compressedMessages: compressedMessagesFallback,
            groupId: '',
            parentMessageId: undefined,
            skipped: true,
          } as GeneralAgentCompressionResultPayload,
          phase: 'compression_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        },
      };
    }
  };
