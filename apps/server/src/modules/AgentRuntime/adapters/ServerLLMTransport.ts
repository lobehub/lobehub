import { randomBytes } from 'node:crypto';

import type {
  BlobStore,
  ContextBuildOutput,
  LLMAttemptExecution,
  LLMAttemptInput,
  LLMAttemptOutput,
  LLMCallErrorInput,
  LLMRetryInput,
  LLMRetryPolicy,
  LLMStreamPayload,
  LLMStreamResult,
  LLMTrace,
  LLMTraceInput,
  LLMTransport,
} from '@lobechat/agent-runtime';
import {
  resolveLLMMaxAttempts,
  resolveLLMRetryBudget,
  shouldRetryLLM,
} from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import {
  type ChatStreamPayload,
  consumeStreamUntilDone,
  ModelEmptyError,
  type ModelRuntime,
} from '@lobechat/model-runtime';
import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace as otelTrace,
} from '@lobechat/observability-otel/api';
import {
  buildChatRequestAttributes,
  buildChatResponseAttributes,
  chatSpanName,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import { toAgentShareVisitorIds } from '@lobechat/types';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type { RuntimeExecutorContext } from '../context';
import { log, sleep } from '../executorHelpers';
import { classifyLLMError } from '../llmErrorClassification';
import {
  createClientLlmExecutorUnavailableError,
  isClientLlmRelayError,
  resolveLlmRelayRetryBudget,
} from '../llmRelay/errors';
import { buildLlmRelayCallId } from '../llmRelay/protocol';
import { RelayModelRuntime } from '../llmRelay/RelayModelRuntime';
import type { LlmExecutionSite } from '../llmRelay/resolveLlmExecutionSite';
import { resolveLlmExecutionSite } from '../llmRelay/resolveLlmExecutionSite';
import { getAgentRuntimeRedisClient } from '../redis';
import type { IStreamEventManager } from '../types';
import { createServerCallLlmAttempt } from './serverCallLlmAttempt';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return JSON.stringify(error);
};

const SERVER_LLM_RETRY_POLICY = {
  noRetryProviders: [BRANDING_PROVIDER],
};

const NETWORK_EMPTY_COMPLETION_MAX_RETRIES = 3;
const NETWORK_EMPTY_COMPLETION_MAX_ATTEMPTS = NETWORK_EMPTY_COMPLETION_MAX_RETRIES + 1;

/**
 * A stream that died on the transport before the model produced anything: no
 * content, no reasoning, no image, no tool call and — decisively — neither cost
 * nor output tokens, so the attempt billed nothing.
 *
 * `ModelEmptyCompletion` is non-retryable by spec precisely because "a retry is
 * a new, potentially billable provider request". That reasoning is what these
 * diagnostics rule out, which is why this narrow shape may retry while every
 * other empty completion still surfaces immediately.
 *
 * Deliberately provider-independent: the zero-output, zero-cost diagnostics
 * carry the whole safety argument on their own. A BYOK stream dropping
 * mid-flight is the same failure, and nothing about a first-party route makes
 * an unbilled network drop more retryable than a third-party one.
 */
const isRetryableNetworkEmptyCompletion = (error: unknown) => {
  if (!(error instanceof ModelEmptyError)) return false;

  const diagnostics = error.diagnostics;
  return (
    diagnostics?.finishReason === 'network_error' &&
    diagnostics.contentLength === 0 &&
    diagnostics.reasoningLength === 0 &&
    diagnostics.imageCount === 0 &&
    diagnostics.toolCallCount === 0 &&
    diagnostics.cost === undefined &&
    diagnostics.outputTokens === undefined
  );
};

class ServerLLMRetryPolicy implements LLMRetryPolicy {
  constructor(private readonly ctx: RuntimeExecutorContext) {}

  classifyError(error: unknown) {
    const classified = classifyLLMError(error);
    return isRetryableNetworkEmptyCompletion(error)
      ? { ...classified, kind: 'retry' as const }
      : classified;
  }

  /**
   * The executor fixes the attempt ceiling before any error exists, so it has to
   * leave room for the error-driven network-empty budget below. Providers that
   * already allow more keep their own ceiling; only a no-retry provider is
   * lifted, and `resolveRetryBudget` still refuses every other error of theirs
   * at the first attempt.
   */
  maxAttempts(provider: string) {
    return Math.max(
      resolveLLMMaxAttempts(provider, SERVER_LLM_RETRY_POLICY),
      NETWORK_EMPTY_COMPLETION_MAX_ATTEMPTS,
    );
  }

  onError({ error }: LLMCallErrorInput) {
    console.error(
      `[StreamingLLMExecutor][${this.ctx.operationId}:${this.ctx.stepIndex}] LLM execution failed:`,
      error,
    );
  }

  onRetry({ attempt, delayMs, error, maxAttempts }: LLMRetryInput) {
    log(
      '[%s:%d] LLM call failed with kind=%s (attempt %d/%d), retrying in %dms ...',
      this.ctx.operationId,
      this.ctx.stepIndex,
      error.kind,
      attempt,
      maxAttempts,
      delayMs,
    );
  }

  resolveRetryBudget(provider: string, error: unknown) {
    if (isRetryableNetworkEmptyCompletion(error)) return NETWORK_EMPTY_COMPLETION_MAX_RETRIES;
    return (
      resolveLlmRelayRetryBudget(error) ?? resolveLLMRetryBudget(provider, SERVER_LLM_RETRY_POLICY)
    );
  }

  async waitForRetry(delayMs: number): Promise<void> {
    await sleep(delayMs);
  }
}

/**
 * The streaming mode the request really uses: the built context carries the
 * agent's chat-config decision (with an explicit operation-level `stream`
 * already folded in), so the payload and the trace must read the same value.
 */
const resolveRequestStream = (
  ctx: RuntimeExecutorContext,
  context: ContextBuildOutput | undefined,
): boolean => {
  const fromContext = (context?.modelParameters as { stream?: boolean } | undefined)?.stream;
  return fromContext ?? ctx.stream ?? true;
};

class ServerLLMTrace implements LLMTrace {
  private readonly chatContext: ReturnType<typeof otelTrace.setSpan>;
  private readonly chatSpan: ReturnType<typeof agentRuntimeTracer.startSpan>;
  private firstChunkAt?: number;
  private readonly llmStartTime = Date.now();
  private readonly operationLogId: string;

  constructor(
    private readonly ctx: RuntimeExecutorContext,
    input: LLMTraceInput,
  ) {
    this.operationLogId = `${ctx.operationId}:${ctx.stepIndex}`;
    log(
      '[%s][call_llm] Starting operation with prepared assistant message: %s',
      this.operationLogId,
      input.assistantMessageId,
    );

    this.chatSpan = agentRuntimeTracer.startSpan(chatSpanName(input.model), {
      attributes: buildChatRequestAttributes({
        conversationId: input.conversationId,
        operationId: ctx.operationId,
        provider: input.provider,
        requestModel: input.model,
        stepIndex: ctx.stepIndex,
        stream: resolveRequestStream(ctx, input.context),
      }),
      kind: SpanKind.CLIENT,
    });
    this.chatContext = otelTrace.setSpan(otelContext.active(), this.chatSpan);
  }

  close(error?: unknown) {
    if (error) {
      this.chatSpan.recordException(error as Error);
      this.chatSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    this.chatSpan.end();
  }

  onFirstChunk() {
    if (this.firstChunkAt === undefined) {
      this.firstChunkAt = Date.now() - this.llmStartTime;
    }
  }

  recordResult(output: LLMAttemptOutput) {
    return this.run(async () => {
      log('[%s] call_llm completed', this.operationLogId);
      this.chatSpan.setAttributes(
        buildChatResponseAttributes({
          cacheReadInputTokens: output.usage?.inputCachedTokens,
          finishReasons: output.finishReason ? [output.finishReason] : undefined,
          inputTokens: output.usage?.totalInputTokens,
          outputTokens: output.usage?.totalOutputTokens,
          reasoningOutputTokens: output.usage?.outputReasoningTokens,
          timeToFirstChunkMs: this.firstChunkAt,
        }),
      );
    });
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return otelContext.with(this.chatContext, task);
  }
}

/**
 * The step's stream manager, with every chunk it re-publishes for a relayed
 * attempt tagged by the attempt's call id, so the executor client can skip
 * the echo of output it already rendered locally.
 */
const tagRelayChunks = (streamManager: IStreamEventManager, callId: string): IStreamEventManager =>
  new Proxy(streamManager, {
    get(target, property, receiver) {
      if (property === 'publishStreamChunk') {
        const publish: IStreamEventManager['publishStreamChunk'] = (operationId, stepIndex, data) =>
          target.publishStreamChunk(operationId, stepIndex, { ...data, relayCallId: callId });
        return publish;
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

/**
 * Server {@link LLMTransport} adapter — wraps model-runtime streaming and
 * returns the aggregated content/usage that package executors need.
 */
export class ServerLLMTransport implements LLMTransport {
  readonly retryPolicy: LLMRetryPolicy;

  private readonly executionSitePromises = new Map<string, Promise<LlmExecutionSite>>();

  private readonly modelRuntimePromises = new Map<
    string,
    ReturnType<ServerLLMTransport['createModelRuntime']>
  >();

  /**
   * Output of the latest relayed attempt that failed after producing some,
   * per assistant message. A re-dispatch that never gets claimed (the tab that
   * ran the attempt is gone) ends the step with nothing of its own to keep.
   */
  private readonly relayPartials = new Map<
    string,
    Pick<LLMAttemptExecution['output'], 'content' | 'thinkingContent'>
  >();

  private relayStreamCount = 0;

  /** Keeps a redriven step's call ids apart from the execution it replaces. */
  private readonly relayGeneration = randomBytes(6).toString('base64url');

  constructor(
    private readonly ctx: RuntimeExecutorContext,
    private readonly blobStore?: BlobStore,
  ) {
    this.retryPolicy = new ServerLLMRetryPolicy(ctx);
  }

  createTrace(input: LLMTraceInput): LLMTrace {
    return new ServerLLMTrace(this.ctx, input);
  }

  async runAttempt(input: LLMAttemptInput): Promise<LLMAttemptExecution> {
    const site = await this.getExecutionSite(input.provider, input.state);

    if (site.site === 'unavailable') {
      throw createClientLlmExecutorUnavailableError(input.provider, site.reason);
    }

    if (site.site === 'client') {
      const callId = buildLlmRelayCallId(
        this.ctx.operationId,
        this.ctx.stepIndex,
        this.relayGeneration,
        input.attempt,
      );
      const relayRuntime = this.createRelayRuntime(input.provider, site, {
        assistantMessageId: input.assistantMessageId,
        attempt: input.attempt,
        callId,
      });
      const execution = await this.runAttemptWithRuntime(input, relayRuntime, {
        ...this.ctx,
        streamManager: tagRelayChunks(this.ctx.streamManager, callId),
      });
      execution.output.executionSite = 'client';
      if (relayRuntime.result.usageEstimated) execution.output.usageEstimated = true;

      if (!execution.ok) await this.keepRelayPartialOnTerminalError(input, execution);
      return execution;
    }

    const modelRuntime = await this.getModelRuntime(input.provider);
    return this.runAttemptWithRuntime(input, modelRuntime);
  }

  async stream(
    payload: LLMStreamPayload,
    handlers?: Parameters<LLMTransport['stream']>[1],
  ): Promise<LLMStreamResult> {
    const runtime = await this.createStreamRuntime(payload.provider);
    const { provider: _provider, ...runtimePayload } = payload;
    let content = '';
    let usage: LLMStreamResult['usage'];
    let streamError: unknown;

    const response = await runtime.chat(runtimePayload as any, {
      callback: {
        onCompletion: async (data: any) => {
          if (data.usage) usage = data.usage;
        },
        onError: async (errorData: unknown) => {
          streamError = errorData;
          handlers?.onError?.(errorData);
        },
        onText: async (text: string) => {
          content += text;
          handlers?.onText?.(text);
        },
      },
      metadata: { topicId: this.ctx.topicId },
      user: this.ctx.userId,
    });

    await consumeStreamUntilDone(response);

    if (streamError) {
      throw new Error(getErrorMessage(streamError));
    }

    const result = { content, usage };
    handlers?.onFinish?.(result);
    return result;
  }

  /**
   * Lightweight calls (context compression) follow the same execution site as
   * the run's attempts; a relayed one gets its own call id outside the attempt
   * numbering.
   */
  private async createStreamRuntime(provider: string) {
    const state = (await this.ctx.loadAgentState?.(this.ctx.operationId)) ?? undefined;
    const site = await this.getExecutionSite(provider, state);

    if (site.site === 'unavailable') {
      throw createClientLlmExecutorUnavailableError(provider, site.reason);
    }
    if (site.site === 'client') {
      this.relayStreamCount += 1;
      return this.createRelayRuntime(provider, site, {
        attempt: 1,
        callId: `${buildLlmRelayCallId(this.ctx.operationId, this.ctx.stepIndex, this.relayGeneration, 1)}:stream${this.relayStreamCount}`,
      });
    }

    return this.createModelRuntime(provider);
  }

  private createRelayRuntime(
    provider: string,
    site: Extract<LlmExecutionSite, { site: 'client' }>,
    call: { assistantMessageId?: string; attempt: number; callId: string },
  ) {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) throw createClientLlmExecutorUnavailableError(provider, 'relay_unsupported');

    return new RelayModelRuntime({
      ...call,
      channelOperationId: site.channelOperationId,
      operationId: this.ctx.operationId,
      preferredClientId: site.preferredClientId,
      provider,
      redis,
      runtimeProvider: site.runtimeProvider,
      stepIndex: this.ctx.stepIndex,
      streamManager: this.ctx.streamManager,
      userId: this.ctx.userId!,
    });
  }

  private getExecutionSite(provider: string, state?: LLMAttemptInput['state']) {
    let promise = this.executionSitePromises.get(provider);
    if (!promise) {
      promise = resolveLlmExecutionSite({
        db: this.ctx.serverDB,
        provider,
        state,
        userId: this.ctx.userId!,
        workspaceId: this.ctx.workspaceId,
      });
      this.executionSitePromises.set(provider, promise);
    }
    return promise;
  }

  /**
   * When a relayed attempt fails for good — the executor vanished and the
   * re-dispatch budget is spent, or the total deadline passed — keep what the
   * device had already produced on the message, marked as cut short, rather
   * than dropping it with the error (U4b). Retried attempts start over, so
   * their partial output is discarded as usual — unless the last re-dispatch
   * produced nothing, in which case the latest earlier partial is kept.
   */
  private async keepRelayPartialOnTerminalError(
    input: LLMAttemptInput,
    execution: Extract<LLMAttemptExecution, { ok: false }>,
  ) {
    const { error } = execution;
    const messageId = input.assistantMessageId;
    if (!messageId || !isClientLlmRelayError(error)) return;

    let output: Pick<LLMAttemptExecution['output'], 'content' | 'thinkingContent'> =
      execution.output;
    if (output.content || output.thinkingContent) {
      this.relayPartials.set(messageId, output);
    } else {
      const earlier = this.relayPartials.get(messageId);
      if (!earlier) return;
      output = earlier;
    }

    const classified = this.retryPolicy.classifyError(error);
    const budget = this.retryPolicy.resolveRetryBudget(input.provider, error);
    if (shouldRetryLLM(classified.kind, input.attempt, budget)) return;

    try {
      await this.ctx.messageModel.update(messageId, {
        content: output.content,
        metadata: { executionSite: 'client', interruptedMidStream: true } as any,
        ...(output.thinkingContent && { reasoning: { content: output.thinkingContent } }),
      });
    } catch (error) {
      console.error('[ServerLLMTransport] Failed to keep relayed partial output:', error);
    }
  }

  private createModelRuntime(provider: string) {
    return initModelRuntimeFromDB(
      this.ctx.serverDB,
      this.ctx.userId!,
      provider,
      this.ctx.workspaceId,
    );
  }

  private getModelRuntime(provider: string) {
    let promise = this.modelRuntimePromises.get(provider);
    if (!promise) {
      promise = this.createModelRuntime(provider);
      this.modelRuntimePromises.set(provider, promise);
    }
    return promise;
  }

  private async runAttemptWithRuntime(
    input: LLMAttemptInput,
    modelRuntime: Pick<ModelRuntime, 'chat' | 'handleChatStreamError'>,
    ctx: RuntimeExecutorContext = this.ctx,
  ): Promise<LLMAttemptExecution> {
    const resolved = input.context.resolvedTools;
    if (!resolved) throw new Error('Resolved tools are required for a server LLM attempt');

    const tools = resolved.tools.length > 0 ? resolved.tools : undefined;
    const chatPayload = {
      messages: input.context.messages as ChatStreamPayload['messages'],
      model: input.model,
      stream: resolveRequestStream(this.ctx, input.context),
      tools,
      ...(input.context.modelParameters as Partial<ChatStreamPayload>),
      ...(typeof input.context.preserveThinking === 'boolean' && {
        preserveThinking: input.context.preserveThinking,
      }),
    };
    const operationLogId = `${this.ctx.operationId}:${this.ctx.stepIndex}`;
    const attempt = createServerCallLlmAttempt({
      attempt: input.attempt,
      blobStore: this.blobStore,
      chatPayload,
      ctx,
      events: input.events,
      maxAttempts: input.maxAttempts,
      messageCount: chatPayload.messages.length,
      model: input.model,
      modelRuntime,
      onFirstChunk: input.onFirstChunk ?? (() => {}),
      operationLogId,
      provider: input.provider,
      resolved,
      // Carry the originating request's client IP / user agent from the run's
      // state.metadata into the attempt so the LLM-call metadata can surface them
      // for auditing and spend attribution.
      clientIp: input.state.principal?.audit?.clientIp,
      // Projected, not spread: `state.principal.actor.shareVisitor` also carries
      // the run's tool/memory restrictions, which have no place in billing
      // metadata. Only the three attribution ids travel.
      agentShareVisitorIds: input.state.principal?.actor?.shareVisitor
        ? toAgentShareVisitorIds(input.state.principal?.actor?.shareVisitor)
        : undefined,
      topicId: input.state.origin?.topicId,
      trigger: input.state.origin?.trigger,
      userAgent: input.state.principal?.audit?.userAgent,
    });

    try {
      await attempt.execute();
      return { ok: true, output: attempt.snapshot() };
    } catch (error) {
      attempt.clearBuffers();
      return { error, ok: false, output: attempt.snapshot() };
    }
  }
}
