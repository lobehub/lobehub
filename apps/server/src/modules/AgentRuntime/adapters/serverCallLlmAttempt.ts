import type { AgentEvent, BlobStore, LLMAttemptOutput } from '@lobechat/agent-runtime';
import { ToolNameResolver } from '@lobechat/context-engine';
import type {
  Base64ImageData,
  ChatStreamPayload,
  ContentPartData,
  ModelRuntime,
  OnFinishData,
} from '@lobechat/model-runtime';
import {
  consumeStreamUntilDone,
  isEmptyModelCompletion,
  ModelEmptyError,
  ModelRefusalError,
} from '@lobechat/model-runtime';
import type {
  ChatImageItem,
  ChatToolPayload,
  GroundingSearch,
  MessageToolCall,
  ModelPerformance,
  ModelReasoning,
  ModelUsage,
} from '@lobechat/types';
import { pickString, toRecord } from '@lobechat/utils/object';

import type { ModelCompletionFailureReason } from '@/business/server/recordModelCompletionFailure';
import { recordModelCompletionFailure } from '@/business/server/recordModelCompletionFailure';

import type { RuntimeExecutorContext } from '../context';
import { isOperationInterrupted, log, timing } from '../executorHelpers';
import {
  createServerCallLlmStreamSink,
  type ServerCallLlmStreamSink,
} from './serverCallLlmStreamSink';
import type { ServerCallLlmTooling } from './serverCallLlmTooling';

interface CreateServerCallLlmAttemptInput {
  attempt: number;
  blobStore?: BlobStore;
  chatPayload: ChatStreamPayload;
  /** Client IP of the originating request, forwarded into the LLM-call metadata for auditing and spend attribution. */
  clientIp?: string;
  ctx: RuntimeExecutorContext;
  events: AgentEvent[];
  maxAttempts: number;
  messageCount: number;
  model: string;
  modelRuntime: Pick<ModelRuntime, 'chat'>;
  onFirstChunk: () => void;
  operationLogId: string;
  provider: string;
  resolved: ServerCallLlmTooling['resolved'];
  topicId?: string;
  trigger?: unknown;
  /** User agent of the originating request, forwarded into the LLM-call metadata for auditing and spend attribution. */
  userAgent?: string;
}

const createStreamExecutionError = (errorData: unknown) => {
  const errorRecord = toRecord(errorData);
  const message = pickString(errorRecord?.message);
  const error = new Error(
    message ? `LLM stream error: ${message}` : `LLM stream error: ${JSON.stringify(errorData)}`,
  );

  if (errorRecord) {
    const { message: _message, ...details } = errorRecord;
    Object.assign(error, details);
  }

  return error;
};

export class ServerCallLlmAttempt {
  private answerSalvagedFromReasoning = false;
  private readonly attempt: number;
  private readonly base64ImageEvents: Base64ImageData[] = [];
  private readonly chatPayload: ChatStreamPayload;
  private readonly clientIp?: string;
  private completion?: OnFinishData;
  private readonly contentPartEvents: ContentPartData[] = [];
  private readonly ctx: RuntimeExecutorContext;
  private finishReason?: string;
  private grounding: GroundingSearch | null = null;
  private readonly imageList: ChatImageItem[] = [];
  private readonly maxAttempts: number;
  private readonly messageCount: number;
  private readonly model: string;
  private readonly modelRuntime: Pick<ModelRuntime, 'chat'>;
  private readonly onFirstChunk: () => void;
  private readonly operationLogId: string;
  private readonly provider: string;
  private reasoning?: ModelReasoning;
  private readonly reasoningPartEvents: ContentPartData[] = [];
  private readonly resolved: ServerCallLlmTooling['resolved'];
  private speed?: ModelPerformance;
  private readonly streamSink: ServerCallLlmStreamSink;
  private streamError?: unknown;
  private toolCalls: MessageToolCall[] = [];
  private toolsCalling: ChatToolPayload[] = [];
  private readonly topicId?: string;
  private readonly trigger?: unknown;
  private readonly userAgent?: string;
  private usage?: ModelUsage;

  constructor({
    attempt,
    blobStore,
    chatPayload,
    clientIp,
    ctx,
    events,
    maxAttempts,
    messageCount,
    model,
    modelRuntime,
    onFirstChunk,
    operationLogId,
    provider,
    resolved,
    topicId,
    trigger,
    userAgent,
  }: CreateServerCallLlmAttemptInput) {
    this.attempt = attempt;
    this.chatPayload = chatPayload;
    this.clientIp = clientIp;
    this.ctx = ctx;
    this.maxAttempts = maxAttempts;
    this.messageCount = messageCount;
    this.model = model;
    this.modelRuntime = modelRuntime;
    this.onFirstChunk = onFirstChunk;
    this.operationLogId = operationLogId;
    this.provider = provider;
    this.resolved = resolved;
    this.streamSink = createServerCallLlmStreamSink({
      blobStore,
      ctx,
      events,
      operationLogId,
    });
    this.topicId = topicId;
    this.trigger = trigger;
    this.userAgent = userAgent;
  }

  async execute(): Promise<void> {
    log(
      '[%s][call_llm] calling model-runtime chat (attempt %d/%d, model: %s, messages: %d, tools: %d)',
      this.operationLogId,
      this.attempt,
      this.maxAttempts,
      this.model,
      this.messageCount,
      this.chatPayload.tools?.length ?? 0,
    );

    const response = await this.modelRuntime.chat(this.chatPayload, {
      callback: {
        onBase64Image: async ({ image }) => {
          this.onFirstChunk();
          this.base64ImageEvents.push({ ...image });
          await this.streamSink.appendBase64Image(image);
        },
        onCompletion: async (data) => {
          this.completion = data;
          if (data.usage) this.usage = data.usage;
          if (data.speed) this.speed = data.speed;
          if (data.finishReason) this.finishReason = data.finishReason;
          if (data.reasoning) this.reasoning = data.reasoning;
        },
        onContentPart: async (part) => {
          this.onFirstChunk();
          this.contentPartEvents.push({ ...part });
          await this.streamSink.appendContentPart(part);
        },
        onError: async (errorData) => {
          this.streamError = errorData;
          console.error(`[${this.operationLogId}][stream_error]`, errorData);
        },
        onGrounding: async (groundingData) => {
          log(`[${this.operationLogId}][grounding] %O`, groundingData);
          this.grounding = groundingData;

          await this.ctx.streamManager.publishStreamChunk(
            this.ctx.operationId,
            this.ctx.stepIndex,
            {
              chunkType: 'grounding',
              grounding: groundingData,
            },
          );
        },
        onReasoningPart: async (part) => {
          this.onFirstChunk();
          this.reasoningPartEvents.push({ ...part });
          await this.streamSink.appendReasoningPart(part);
        },
        onText: async (text) => {
          this.onFirstChunk();
          timing(
            '[%s] onText received chunk at %d, length: %d',
            this.operationLogId,
            Date.now(),
            text.length,
          );
          await this.streamSink.appendText(text);
        },
        onThinking: async (reasoning) => {
          this.onFirstChunk();
          timing(
            '[%s] onThinking received chunk at %d, length: %d',
            this.operationLogId,
            Date.now(),
            reasoning.length,
          );
          await this.streamSink.appendThinking(reasoning);
        },
        onToolsCalling: async ({ toolsCalling: raw }) => {
          const resolvedCalls = new ToolNameResolver().resolve(
            raw,
            this.resolved.promptManifestMap,
            this.resolved.tools.map((tool) => tool.function.name),
          );
          const payload = resolvedCalls.map((toolCall) => ({
            ...toolCall,
            executor: this.resolved.executorMap?.[toolCall.identifier],
            source: this.resolved.sourceMap[toolCall.identifier],
          }));

          this.toolsCalling = payload;
          // Keep raw arguments through execution so malformed JSON can reach the
          // tool error path and give the model a self-repair signal. Finalizers
          // sanitize only the persisted DB and replay-state copies.
          this.toolCalls = raw;

          await this.streamSink.flushTextBuffer();
          await this.ctx.streamManager.publishStreamChunk(
            this.ctx.operationId,
            this.ctx.stepIndex,
            {
              chunkType: 'tools_calling',
              toolsCalling: payload,
            },
          );
        },
      },
      metadata: {
        clientIp: this.clientIp,
        operationId: this.ctx.operationId,
        topicId: this.topicId,
        trigger: this.trigger,
        userAgent: this.userAgent,
      },
      user: this.ctx.userId,
    });

    await consumeStreamUntilDone(response);

    if (this.streamError) throw createStreamExecutionError(this.streamError);

    await this.streamSink.flushTextBuffer();
    await this.streamSink.flushReasoningBuffer();
    this.streamSink.clearBuffers();
    await this.streamSink.waitForImageUploads();

    await this.assertNonEmptyCompletion();
    this.salvageAnswerFromReasoning();
    this.logResult();
  }

  clearBuffers() {
    this.streamSink.clearBuffers();
  }

  snapshot(): LLMAttemptOutput {
    return {
      answerSalvagedFromReasoning: this.answerSalvagedFromReasoning,
      content: this.streamSink.content,
      contentParts: [...this.streamSink.contentParts],
      finishReason: this.finishReason,
      grounding: this.grounding,
      hasContentImages: this.streamSink.hasContentImages,
      hasReasoningImages: this.streamSink.hasReasoningImages,
      imageList: [...this.imageList],
      reasoning: this.reasoning,
      reasoningParts: [...this.streamSink.reasoningParts],
      speed: this.speed,
      thinkingContent: this.streamSink.thinkingContent,
      toolCalls: [...this.toolCalls],
      toolsCalling: [...this.toolsCalling],
      usage: this.usage,
    };
  }

  private async assertNonEmptyCompletion() {
    const imageCount = this.getOutputImageCount();
    const isRefusal = this.finishReason?.toLowerCase() === 'refusal';
    /**
     * A refusal needs ordinary response output to count as a successful
     * completion. Provider-internal reasoning alone must not turn a blank
     * refusal into a successful assistant message.
     */
    const visibleReasoning = isRefusal ? '' : this.streamSink.thinkingContent;
    const isEmpty = isEmptyModelCompletion({
      content: this.streamSink.content,
      hasGrounding: !!this.grounding,
      imageCount,
      outputTokens: this.usage?.totalOutputTokens,
      reasoning: visibleReasoning,
      toolCallCount: this.toolsCalling.length + this.toolCalls.length,
    });

    if (!isEmpty || (await isOperationInterrupted(this.ctx))) return;

    const diagnostics = {
      attempt: this.attempt,
      contentLength: this.streamSink.content.length,
      cost: this.usage?.cost,
      finishReason: this.finishReason,
      imageCount,
      maxAttempts: this.maxAttempts,
      model: this.model,
      outputTokens: this.usage?.totalOutputTokens,
      provider: this.provider,
      reasoningLength: this.streamSink.thinkingContent.length,
      toolCallCount: this.toolsCalling.length + this.toolCalls.length,
    };

    await this.recordCompletionFailure(isRefusal ? 'refusal' : 'empty_completion');

    if (isRefusal) {
      log(
        '[%s] Model explicitly refused an empty completion (attempt %d/%d) — throwing terminal ModelRefusalError',
        this.operationLogId,
        this.attempt,
        this.maxAttempts,
      );
      throw new ModelRefusalError(undefined, diagnostics);
    }

    log(
      '[%s] Model returned an empty completion (attempt %d/%d) — throwing terminal ModelEmptyError',
      this.operationLogId,
      this.attempt,
      this.maxAttempts,
    );
    throw new ModelEmptyError(undefined, diagnostics);
  }

  /**
   * Native multimodal responses store generated images in contentParts rather
   * than the legacy imageList. Count both paths so image-only completions are
   * not mistaken for empty provider responses.
   */
  private getOutputImageCount() {
    const contentPartImageCount = this.streamSink.contentParts.filter(
      (part) => part.type === 'image',
    ).length;

    return this.imageList.length + contentPartImageCount;
  }

  private async recordCompletionFailure(reason: ModelCompletionFailureReason) {
    try {
      await recordModelCompletionFailure({
        attempt: this.attempt,
        maxAttempts: this.maxAttempts,
        model: this.model,
        operationId: this.ctx.operationId,
        operationLogId: this.operationLogId,
        provider: this.provider,
        reason,
        request: this.chatPayload,
        response: {
          base64ImageEvents: [...this.base64ImageEvents],
          completion: this.completion,
          contentPartEvents: [...this.contentPartEvents],
          output: this.snapshot(),
          reasoningPartEvents: [...this.reasoningPartEvents],
        },
        stepIndex: this.ctx.stepIndex,
        topicId: this.topicId,
        trigger: this.trigger,
        userId: this.ctx.userId,
        workspaceId: this.ctx.workspaceId,
      });
    } catch (error) {
      console.error('[ModelCompletionFailure] Failed to record completion evidence.', {
        error: error instanceof Error ? error.message : String(error),
        operationId: this.ctx.operationId,
        stepIndex: this.ctx.stepIndex,
      });
    }
  }

  private logResult() {
    log(
      '[%s] finish model-runtime calling | content: %d chars | reasoning: %d chars | tools: %d | usage: %s',
      this.operationLogId,
      this.streamSink.content.length,
      this.streamSink.thinkingContent.length,
      this.toolsCalling.length,
      this.usage ? 'yes' : 'none',
    );

    if (this.streamSink.thinkingContent) {
      log(`[${this.operationLogId}][reasoning]`, this.streamSink.thinkingContent);
    }
    if (this.streamSink.content) {
      log(`[${this.operationLogId}][content]`, this.streamSink.content);
    }
    if (this.toolsCalling.length > 0) {
      log(`[${this.operationLogId}][toolsCalling] `, this.toolsCalling);
    }
    if (this.usage) {
      log(`[${this.operationLogId}][usage] %O`, this.usage);
    }
  }

  private salvageAnswerFromReasoning() {
    const isTerminalNaturalStop = this.finishReason === 'end_turn' || this.finishReason === 'stop';
    if (
      isTerminalNaturalStop &&
      this.toolsCalling.length === 0 &&
      this.toolCalls.length === 0 &&
      this.streamSink.content.trim().length === 0 &&
      this.streamSink.thinkingContent.trim().length > 0 &&
      !this.streamSink.hasReasoningImages
    ) {
      log(
        '[%s] answer-in-thinking salvage: promoting %d chars of reasoning to content',
        this.operationLogId,
        this.streamSink.thinkingContent.length,
      );
      this.streamSink.content = this.streamSink.thinkingContent;
      this.streamSink.thinkingContent = '';
      this.answerSalvagedFromReasoning = true;
    }
  }
}

export const createServerCallLlmAttempt = (input: CreateServerCallLlmAttemptInput) =>
  new ServerCallLlmAttempt(input);
