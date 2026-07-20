import type {
  LLMAttemptExecution,
  LLMAttemptInput,
  LLMAttemptOutput,
  LLMCallErrorInput,
  LLMRetryInput,
  LLMRetryPolicy,
  LLMStreamPayload,
  LLMStreamResult,
  LLMTransport,
} from '@lobechat/agent-runtime';
import {
  classifyLLMError,
  resolveLLMMaxAttempts,
  resolveLLMRetryBudget,
} from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { isEmptyModelCompletion, ModelEmptyError } from '@lobechat/model-runtime';
import type { ChatMessageError, MessageMetadata, ModelReasoning } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { t } from 'i18next';

import { chatService } from '@/services/chat';
import { getFileStoreState } from '@/store/file/store';
import { sleep } from '@/utils/sleep';

import type { ChatStore } from '../../store';
import { StreamingHandler } from '../StreamingHandler';
import type { StreamChunk, StreamingResult } from '../types/streaming';
import type { ClientLLMModelParameters } from './ClientContextBuilder';
import type { ClientRuntimeSession } from './ClientRuntimeStreamSink';

const CLIENT_LLM_RETRY_POLICY = {
  isEmptyCompletionError: (error: unknown) => error instanceof ModelEmptyError,
  noRetryProviders: [BRANDING_PROVIDER],
};

const createStreamExecutionError = (errorData: unknown) => {
  if (errorData instanceof Error) return errorData;

  const record =
    errorData && typeof errorData === 'object' ? (errorData as Record<string, any>) : undefined;
  const message =
    (typeof record?.message === 'string' && record.message) ||
    (typeof errorData === 'string' ? errorData : JSON.stringify(errorData));
  const error = new Error(message || 'LLM stream failed');

  if (record) Object.assign(error, record);
  return error;
};

const getGoogleBlockedReason = (error: ChatMessageError): string | undefined => {
  const body = error.body as
    | {
        context?: { finishReason?: unknown; promptFeedback?: { blockReason?: unknown } };
        provider?: unknown;
      }
    | undefined;

  if (body?.provider !== 'google') return undefined;

  const promptFeedbackReason = body.context?.promptFeedback?.blockReason;
  if (typeof promptFeedbackReason === 'string') return promptFeedbackReason;

  const finishReason = body.context?.finishReason;
  return typeof finishReason === 'string' ? finishReason : undefined;
};

const localizeError = (error: ChatMessageError): ChatMessageError => {
  const blockReason = getGoogleBlockedReason(error);
  if (!blockReason) return error;

  const translationKey = `response.GoogleAIBlockReason.${blockReason}`;
  const localized = t(translationKey as any, {
    defaultValue: error.message ?? '',
    ns: 'error',
  }).trim();

  if (!localized || localized === translationKey) return error;

  return {
    ...error,
    body: {
      ...(error.body && typeof error.body === 'object' ? error.body : {}),
      message: localized,
    },
    message: localized,
  };
};

const toChatMessageError = (error: unknown, traceId?: string): ChatMessageError => {
  const record = error && typeof error === 'object' ? (error as Record<string, any>) : {};
  const body = record.body && typeof record.body === 'object' ? record.body : record;

  return localizeError({
    ...record,
    body: { ...body, ...(traceId && { traceId }) },
    message:
      typeof record.message === 'string'
        ? record.message
        : error instanceof Error
          ? error.message
          : String(error),
    type: record.errorType ?? record.type ?? ChatErrorType.UnknownChatFetchError,
  });
};

class ClientLLMRetryPolicy implements LLMRetryPolicy {
  constructor(
    private readonly get: () => ChatStore,
    private readonly operationId: string,
    private readonly session: ClientRuntimeSession,
  ) {}

  classifyError(error: unknown) {
    return classifyLLMError(error);
  }

  maxAttempts(provider: string) {
    return resolveLLMMaxAttempts(provider, CLIENT_LLM_RETRY_POLICY);
  }

  onError({ error, events, interrupted, retryBudget }: LLMCallErrorInput) {
    if (error instanceof ModelEmptyError && error.diagnostics) {
      error.diagnostics.retryBudget = retryBudget;
      error.diagnostics.retryEvents = events
        .filter((event) => event.type === 'stream_retry')
        .map((event) => event.data);
    }

    if (interrupted || !this.session.assistantMessageId) return;

    const localizedError = toChatMessageError(
      error,
      this.get().operations[this.operationId]?.metadata?.traceId,
    );
    if (error && typeof error === 'object') Object.assign(error, localizedError);
    this.get().internal_dispatchMessage(
      {
        id: this.session.assistantMessageId,
        type: 'updateMessage',
        value: { error: localizedError },
      },
      { operationId: this.operationId },
    );
  }

  onRetry(_input: LLMRetryInput) {
    // The package publishes the canonical stream_retry event through StreamSink.
  }

  resolveRetryBudget(provider: string, error: unknown) {
    return resolveLLMRetryBudget(provider, error, CLIENT_LLM_RETRY_POLICY);
  }

  async waitForRetry(delayMs: number): Promise<void> {
    await sleep(delayMs);
  }
}

interface ClientLLMTransportOptions {
  get: () => ChatStore;
  metadata?: Pick<MessageMetadata, 'trigger'>;
  operationId: string;
  session: ClientRuntimeSession;
}

export class ClientLLMTransport implements LLMTransport {
  readonly retryPolicy: LLMRetryPolicy;

  constructor(private readonly context: ClientLLMTransportOptions) {
    this.retryPolicy = new ClientLLMRetryPolicy(context.get, context.operationId, context.session);
  }

  async runAttempt(input: LLMAttemptInput): Promise<LLMAttemptExecution> {
    const operation = this.context.get().operations[this.context.operationId];
    if (!operation) throw new Error(`Operation not found: ${this.context.operationId}`);

    const assistantMessageId = this.context.session.assistantMessageId;
    if (!assistantMessageId) throw new Error('Client call_llm stream started without a message id');

    const { groupId, subAgentId, topicId } = operation.context;
    const agentId = groupId && subAgentId ? subAgentId : operation.context.agentId!;
    const modelParameters = input.context.modelParameters as ClientLLMModelParameters | undefined;
    if (!modelParameters) throw new Error('Client call_llm requires prepared model parameters');

    const offeredToolNames = (input.context.resolvedTools?.tools ?? []).map(
      (tool) => tool.function.name,
    );
    const handler = new StreamingHandler(
      {
        agentId,
        groupId,
        messageId: assistantMessageId,
        operationId: this.context.operationId,
        topicId,
      },
      {
        onContentUpdate: (content, reasoning, contentMetadata) => {
          this.dispatchMessage(assistantMessageId, {
            content,
            reasoning,
            ...(contentMetadata && {
              metadata: {
                isMultimodal: contentMetadata.isMultimodal,
                tempDisplayContent: contentMetadata.tempDisplayContent,
              },
            }),
          });
        },
        onGroundingUpdate: (search) => this.dispatchMessage(assistantMessageId, { search }),
        onImagesUpdate: (imageList) => this.dispatchMessage(assistantMessageId, { imageList }),
        onReasoningComplete: (operationId) => this.context.get().completeOperation(operationId),
        onReasoningStart: () => {
          const { operationId } = this.context.get().startOperation({
            context: { ...operation.context, agentId, messageId: assistantMessageId },
            parentOperationId: this.context.operationId,
            type: 'reasoning',
          });
          this.context.get().associateMessageWithOperation(assistantMessageId, operationId);
          return operationId;
        },
        onReasoningUpdate: (reasoning) => this.dispatchMessage(assistantMessageId, { reasoning }),
        onToolCallsUpdate: (tools) => this.dispatchMessage(assistantMessageId, { tools }),
        toggleToolCallingStreaming: this.context.get().internal_toggleToolCallingStreaming,
        transformToolCalls: (calls) =>
          this.context.get().internal_transformToolCalls(calls, offeredToolNames),
        uploadBase64Image: (data) =>
          getFileStoreState()
            .uploadBase64FileWithProgress(data)
            .then((file) => ({
              alt: file?.filename || file?.id,
              id: file?.id,
              url: file?.url,
            })),
      },
    );

    let finalResult: StreamingResult | undefined;
    let finishData: Parameters<StreamingHandler['handleFinish']>[0] = {};
    let streamError: unknown;
    let firstChunkReceived = false;
    const markFirstChunk = () => {
      if (firstChunkReceived) return;
      firstChunkReceived = true;
      input.onFirstChunk?.();
    };

    try {
      await chatService.getChatCompletion(
        {
          ...modelParameters.params,
          messages: input.context.messages as any,
          model: input.model,
          provider: input.provider,
        },
        {
          ...modelParameters.options,
          metadata: this.context.metadata,
          onErrorHandle: (error) => {
            streamError = createStreamExecutionError(error);
          },
          onFinish: async (
            _content,
            { traceId, observationId, toolCalls, reasoning, grounding, usage, speed, type },
          ) => {
            finishData = {
              grounding,
              observationId,
              reasoning,
              speed,
              toolCalls,
              traceId,
              type,
              usage,
            };
            finalResult = await handler.handleFinish(finishData);
          },
          onMessageHandle: async (chunk) => {
            markFirstChunk();
            handler.handleChunk(chunk as StreamChunk);
          },
          signal: operation.abortController.signal,
        },
      );
    } catch (error) {
      streamError = error;
    }

    const interrupted =
      operation.abortController.signal.aborted ||
      this.context.get().operations[this.context.operationId]?.status === 'cancelled';
    if (interrupted && !finishData.type) finishData.type = 'abort';
    if (interrupted && finalResult && !finalResult.finishType) {
      finalResult = {
        ...finalResult,
        finishType: 'abort',
        metadata: { ...finalResult.metadata, finishType: 'abort' },
      };
    }

    finalResult ??= await handler.handleFinish(finishData);
    const output = this.buildAttemptOutput(handler, finalResult, finishData);

    if (streamError && !interrupted) return { error: streamError, ok: false, output };

    if (
      isEmptyModelCompletion({
        content: output.content,
        hasGrounding: !!output.grounding,
        imageCount: output.imageList.length + (output.hasContentImages ? 1 : 0),
        outputTokens: output.usage?.totalOutputTokens,
        reasoning: output.thinkingContent,
        toolCallCount: output.toolsCalling.length + output.toolCalls.length,
      }) &&
      !interrupted
    ) {
      return {
        error: new ModelEmptyError(undefined, {
          attempt: input.attempt,
          contentLength: output.content.length,
          finishReason: output.finishReason,
          imageCount: output.imageList.length,
          maxAttempts: input.maxAttempts,
          model: input.model,
          outputTokens: output.usage?.totalOutputTokens,
          provider: input.provider,
          reasoningLength: output.thinkingContent.length,
          toolCallCount: output.toolsCalling.length + output.toolCalls.length,
        }),
        ok: false,
        output,
      };
    }

    return { ok: true, output };
  }

  async stream(
    payload: LLMStreamPayload,
    handlers?: Parameters<LLMTransport['stream']>[1],
    signal?: AbortSignal,
  ): Promise<LLMStreamResult> {
    let content = '';
    let reasoning = '';
    let usage: LLMStreamResult['usage'];
    let streamError: unknown;

    await chatService.getChatCompletion(payload as any, {
      onErrorHandle: (error) => {
        streamError = createStreamExecutionError(error);
        handlers?.onError?.(streamError);
      },
      onFinish: async (_content, data) => {
        content = _content || content;
        reasoning = data.reasoning?.content || reasoning;
        usage = data.usage;
      },
      onMessageHandle: (chunk) => {
        const streamChunk = chunk as StreamChunk;
        handlers?.onChunk?.(streamChunk);
        if (streamChunk.type === 'text') {
          content += streamChunk.text;
          handlers?.onText?.(streamChunk.text);
        }
        if (streamChunk.type === 'reasoning') reasoning += streamChunk.text;
      },
      signal,
    });

    if (streamError) throw streamError;

    const result = { content, reasoning, usage };
    handlers?.onFinish?.(result);
    return result;
  }

  private buildAttemptOutput(
    handler: StreamingHandler,
    result: StreamingResult,
    finishData: Parameters<StreamingHandler['handleFinish']>[0],
  ): LLMAttemptOutput {
    let content = handler.getOutput();
    let thinkingContent = handler.getThinkingContent();
    let reasoning = result.metadata.reasoning as ModelReasoning | undefined;
    let answerSalvagedFromReasoning = false;
    const isTerminalStop = result.finishType === 'end_turn' || result.finishType === 'stop';

    if (
      isTerminalStop &&
      !content.trim() &&
      thinkingContent.trim() &&
      !handler.hasReasoningImages() &&
      !result.tools?.length &&
      !result.toolCalls?.length
    ) {
      content = thinkingContent;
      thinkingContent = '';
      reasoning = undefined;
      answerSalvagedFromReasoning = true;
    }

    return {
      answerSalvagedFromReasoning,
      content,
      contentParts: handler.getContentParts(),
      finishReason: result.finishType,
      grounding: result.metadata.search ?? null,
      hasContentImages: handler.hasContentImages(),
      hasReasoningImages: handler.hasReasoningImages(),
      imageList: result.metadata.imageList ?? [],
      observationId: finishData.observationId ?? undefined,
      reasoning,
      reasoningParts: handler.getReasoningParts(),
      speed: result.metadata.performance,
      thinkingContent,
      toolCalls: result.toolCalls ?? [],
      toolsCalling: result.tools ?? [],
      traceId: finishData.traceId ?? undefined,
      usage: result.usage,
    };
  }

  private dispatchMessage(id: string, value: Record<string, unknown>) {
    this.context
      .get()
      .internal_dispatchMessage(
        { id, type: 'updateMessage', value },
        { operationId: this.context.operationId },
      );
  }
}
