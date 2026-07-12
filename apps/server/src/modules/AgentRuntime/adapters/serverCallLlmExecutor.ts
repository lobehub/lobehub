import {
  type AgentState,
  type ContextBuildOutput,
  type LLMAttemptOutput,
  type LLMTransport,
  type LLMTurnAttemptInput,
  type LLMTurnErrorInput,
  type LLMTurnRetryInput,
  type LLMTurnSession,
  resolveLLMMaxAttempts,
  resolveLLMRetryBudget,
} from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { ModelEmptyError } from '@lobechat/model-runtime';
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

import { type RuntimeExecutorContext } from '../context';
import { log, sleep } from '../executorHelpers';
import { classifyLLMError } from '../llmErrorClassification';

interface ServerCallLlmExecutionContext {
  assistantMessage: { id: string };
  context: ContextBuildOutput;
  model: string;
  provider: string;
  runAttempt: NonNullable<LLMTransport['runAttempt']>;
  state: AgentState;
}

const SERVER_LLM_RETRY_POLICY = {
  isEmptyCompletionError: (error: unknown) => error instanceof ModelEmptyError,
  noRetryProviders: [BRANDING_PROVIDER],
};

class ServerCallLlmTurnSession implements LLMTurnSession {
  readonly maxAttempts: number;

  private readonly chatContext: ReturnType<typeof otelTrace.setSpan>;
  private readonly chatSpan: ReturnType<typeof agentRuntimeTracer.startSpan>;
  private firstChunkAt?: number;
  private readonly llmStartTime = Date.now();
  private readonly operationLogId: string;

  constructor(
    private readonly ctx: RuntimeExecutorContext,
    private readonly prepared: ServerCallLlmExecutionContext,
  ) {
    const { context, model, provider, state } = prepared;
    const processedMessages = context.messages as Array<{ role?: string }>;

    if (!context.resolvedTools) {
      throw new Error('Resolved tools are required for a server LLM turn');
    }
    if (!processedMessages.some((message) => message.role !== 'system')) {
      throw new Error(
        `call_llm produced no non-system messages for ${provider}/${model} ` +
          `(topic=${state.metadata?.topicId ?? 'n/a'}, step=${ctx.stepIndex}); refusing to dispatch`,
      );
    }

    this.operationLogId = `${ctx.operationId}:${ctx.stepIndex}`;
    this.maxAttempts = resolveLLMMaxAttempts(provider, SERVER_LLM_RETRY_POLICY);
    log(
      '[%s][call_llm] Starting operation with prepared assistant message: %s',
      this.operationLogId,
      prepared.assistantMessage.id,
    );

    this.chatSpan = agentRuntimeTracer.startSpan(chatSpanName(model), {
      attributes: buildChatRequestAttributes({
        conversationId: state.metadata?.topicId,
        operationId: ctx.operationId,
        provider,
        requestModel: model,
        stepIndex: ctx.stepIndex,
        stream: ctx.stream ?? true,
      }),
      kind: SpanKind.CLIENT,
    });
    this.chatContext = otelTrace.setSpan(otelContext.active(), this.chatSpan);
  }

  classifyError(error: unknown) {
    return classifyLLMError(error);
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

  async handleError({ error, events, retryBudget }: LLMTurnErrorInput) {
    await otelContext.with(this.chatContext, async () => {
      if (error instanceof ModelEmptyError && error.diagnostics) {
        error.diagnostics.retryBudget = retryBudget;
        error.diagnostics.retryEvents = events
          .filter((event) => event.type === 'stream_retry')
          .map((event) => event.data);
      }

      console.error(
        `[StreamingLLMExecutor][${this.ctx.operationId}:${this.ctx.stepIndex}] LLM execution failed:`,
        error,
      );
    });
  }

  resolveRetryBudget(error: unknown) {
    return resolveLLMRetryBudget(this.prepared.provider, error, SERVER_LLM_RETRY_POLICY);
  }

  onRetry({ attempt, delayMs, error, maxAttempts }: LLMTurnRetryInput) {
    log(
      '[%s] LLM call failed with kind=%s (attempt %d/%d), retrying in %dms ...',
      this.operationLogId,
      error.kind,
      attempt,
      maxAttempts,
      delayMs,
    );
  }

  recordResult(output: LLMAttemptOutput) {
    return otelContext.with(this.chatContext, () => {
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

  runAttempt({ attempt, events }: LLMTurnAttemptInput) {
    return otelContext.with(this.chatContext, () =>
      this.prepared.runAttempt({
        attempt,
        context: this.prepared.context,
        events,
        maxAttempts: this.maxAttempts,
        model: this.prepared.model,
        onFirstChunk: () => {
          if (this.firstChunkAt === undefined) {
            this.firstChunkAt = Date.now() - this.llmStartTime;
          }
        },
        provider: this.prepared.provider,
        state: this.prepared.state,
      }),
    );
  }

  async waitForRetry(delayMs: number): Promise<void> {
    await sleep(delayMs);
  }
}

export const openServerCallLlmTurn = (
  ctx: RuntimeExecutorContext,
  prepared: ServerCallLlmExecutionContext,
): LLMTurnSession => new ServerCallLlmTurnSession(ctx, prepared);
