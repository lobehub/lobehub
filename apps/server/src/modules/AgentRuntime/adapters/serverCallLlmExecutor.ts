import {
  type AgentEvent,
  type AgentState,
  type ContextBuildOutput,
  type GeneralAgentCallLLMResultPayload,
  getLLMRetryDelayMs,
  type InstructionExecutionResult,
  type LLMTransport,
  resolveLLMMaxAttempts,
  resolveLLMRetryBudget,
  shouldRetryLLM,
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
import { isOperationInterrupted, log, sleep } from '../executorHelpers';
import { formatErrorEventData } from '../formatErrorEventData';
import { classifyLLMError } from '../llmErrorClassification';
import {
  finalizeServerCallLlmResult,
  persistInterruptedServerCallLlmResult,
} from './serverCallLlmFinalizer';

interface ServerCallLlmExecutionContext {
  assistantMessage: { id: string };
  context: ContextBuildOutput;
  model: string;
  provider: string;
  runAttempt: NonNullable<LLMTransport['runAttempt']>;
  state: AgentState;
  stepLabel?: string;
}

const SERVER_LLM_RETRY_POLICY = {
  isEmptyCompletionError: (error: unknown) => error instanceof ModelEmptyError,
  noRetryProviders: [BRANDING_PROVIDER],
};

class ServerCallLlmTurn {
  constructor(
    private readonly ctx: RuntimeExecutorContext,
    private readonly prepared: ServerCallLlmExecutionContext,
  ) {}

  async execute(): Promise<InstructionExecutionResult> {
    const { ctx, prepared } = this;
    const { state } = prepared;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];
    let visibleOutputEndPublishedStepIndex: number | undefined;
    const {
      assistantMessage: assistantMessageItem,
      context,
      model,
      provider,
      runAttempt,
      stepLabel,
    } = prepared;
    const { messages: preparedMessages, replayAssistantReasoning: shouldReplayAssistantReasoning } =
      context;
    const processedMessages = preparedMessages as Array<{ role?: string }>;
    const operationLogId = `${operationId}:${stepIndex}`;
    log(
      '[%s][call_llm] Starting operation with prepared assistant message: %s',
      operationLogId,
      assistantMessageItem.id,
    );

    try {
      if (!context.resolvedTools) {
        throw new Error('Resolved tools are required for a server LLM turn');
      }

      // A turn must carry at least one non-system message. Anthropic-compatible
      // providers (anthropic / deepseek) move `role: system` into a separate
      // top-level field, so a system-only array dispatches `messages: []` and
      // the upstream rejects it with a 400 `messages: at least one message is
      // required` (surfaced as an opaque UpstreamHttpError); for other providers
      // a system-only turn has nothing to respond to. Either way the context
      // pipeline dropped everything real — fail fast with a locatable internal
      // error instead of a doomed round-trip. Attributed here (agent-runtime),
      // not the provider layer, since it's our own pipeline that emptied it.
      if (!processedMessages.some((message) => message.role !== 'system')) {
        throw new Error(
          `call_llm produced no non-system messages for ${provider}/${model} ` +
            `(topic=${state.metadata?.topicId ?? 'n/a'}, step=${stepIndex}); refusing to dispatch`,
        );
      }

      const stream = ctx.stream ?? true;
      const maxAttempts = resolveLLMMaxAttempts(provider, SERVER_LLM_RETRY_POLICY);

      // OTel chat span — wraps all retry attempts; TTFT recorded on the first
      // text/reasoning chunk regardless of which attempt produced it (the
      // semantic span represents the LLM call from the agent's perspective).
      const llmStartTime = Date.now();
      let firstChunkAt: number | undefined;
      const onFirstChunk = () => {
        if (firstChunkAt === undefined) firstChunkAt = Date.now() - llmStartTime;
      };
      const chatSpan = agentRuntimeTracer.startSpan(chatSpanName(model), {
        attributes: buildChatRequestAttributes({
          conversationId: state.metadata?.topicId,
          operationId,
          provider,
          requestModel: model,
          stepIndex,
          stream,
        }),
        kind: SpanKind.CLIENT,
      });
      const chatCtx = otelTrace.setSpan(otelContext.active(), chatSpan);

      try {
        return await otelContext.with(chatCtx, async () => {
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const execution = await runAttempt({
              attempt,
              context,
              events,
              maxAttempts,
              model,
              onFirstChunk,
              provider,
              state,
            });
            const llmAttempt = execution.output;

            try {
              if (!execution.ok) throw execution.error;

              const {
                answerSalvagedFromReasoning,
                finishReason: currentStepFinishReason,
                grounding,
                imageList,
                speed: currentStepSpeed,
                toolCalls: tool_calls,
                toolsCalling,
                usage: currentStepUsage,
              } = llmAttempt;

              // Add a complete llm_stream event (including all streaming chunks)
              events.push({
                result: {
                  content: llmAttempt.content,
                  finishReason: currentStepFinishReason,
                  reasoning: llmAttempt.reasoning,
                  tool_calls,
                  usage: currentStepUsage,
                },
                type: 'llm_result',
              });

              // Publish stream end event
              await streamManager.publishStreamEvent(operationId, {
                data: {
                  finalContent: llmAttempt.content,
                  grounding,
                  ...(stepLabel && { stepLabel }),
                  imageList: imageList.length > 0 ? imageList : undefined,
                  reasoning: llmAttempt.reasoning || undefined,
                  toolsCalling,
                  usage: currentStepUsage,
                },
                stepIndex,
                type: 'stream_end',
              });

              const canPublishEarlyFinalAnswerVisibleEnd =
                ctx.allowEarlyFinalAnswerVisibleOutputEnd ?? true;
              if (
                canPublishEarlyFinalAnswerVisibleEnd &&
                toolsCalling.length === 0 &&
                tool_calls.length === 0
              ) {
                try {
                  // Example: a no-tool answer can publish stream_end, then spend
                  // several seconds in DB/Redis persistence before terminal done.
                  // Clear visible loading once no more text/tool output can appear.
                  await streamManager.publishStreamEvent(operationId, {
                    data: { reason: 'final_answer' },
                    stepIndex,
                    type: 'visible_output_end',
                  });
                  visibleOutputEndPublishedStepIndex = stepIndex;
                } catch (error) {
                  // Terminal saveStepResult still publishes the same hint as a fallback.
                  console.error('Failed to publish visible_output_end:', error);
                }
              }

              log('[%s:%d] call_llm completed', operationId, stepIndex);

              const newState = await finalizeServerCallLlmResult({
                answerSalvagedFromReasoning,
                assistantMessageId: assistantMessageItem.id,
                currentStepSpeed,
                currentStepUsage,
                grounding,
                imageList,
                messageModel: ctx.messageModel,
                model,
                provider,
                shouldReplayAssistantReasoning,
                state,
                stepLabel,
                streamOutput: llmAttempt,
                toolCalls: tool_calls,
                toolsCalling,
                visibleOutputEndPublishedStepIndex,
              });

              // Record chat response attributes on the OTel span.
              chatSpan.setAttributes(
                buildChatResponseAttributes({
                  cacheReadInputTokens: currentStepUsage?.inputCachedTokens,
                  finishReasons: currentStepFinishReason ? [currentStepFinishReason] : undefined,
                  inputTokens: currentStepUsage?.totalInputTokens,
                  outputTokens: currentStepUsage?.totalOutputTokens,
                  reasoningOutputTokens: currentStepUsage?.outputReasoningTokens,
                  timeToFirstChunkMs: firstChunkAt,
                }),
              );

              return {
                events,
                newState,
                nextContext: {
                  payload: {
                    hasToolsCalling: toolsCalling.length > 0,
                    // Pass assistant message ID as parentMessageId for tool calls
                    parentMessageId: assistantMessageItem.id,
                    result: { content: llmAttempt.content, tool_calls },
                    toolsCalling,
                  } as GeneralAgentCallLLMResultPayload,
                  phase: 'llm_result' as const,
                  session: {
                    eventCount: events.length,
                    messageCount: newState.messages.length,
                    sessionId: operationId,
                    status: 'running' as const,
                    stepCount: state.stepCount + 1,
                  },
                  stepUsage: currentStepUsage,
                },
              };
            } catch (error) {
              const classified = classifyLLMError(error);
              const interrupted = await isOperationInterrupted(ctx);

              const retryBudget = resolveLLMRetryBudget(provider, error, SERVER_LLM_RETRY_POLICY);

              if (!interrupted && shouldRetryLLM(classified.kind, attempt, retryBudget)) {
                const delayMs = getLLMRetryDelayMs(attempt);

                log(
                  '[%s] LLM call failed with kind=%s (attempt %d/%d), retrying in %dms ...',
                  operationLogId,
                  classified.kind,
                  attempt,
                  maxAttempts,
                  delayMs,
                );

                const retryEvent: AgentEvent = {
                  data: {
                    attempt: attempt + 1,
                    delayMs,
                    errorType: classified.code,
                    kind: classified.kind,
                    maxAttempts,
                  },
                  type: 'stream_retry',
                };
                events.push(retryEvent);

                await streamManager.publishStreamEvent(operationId, {
                  data: retryEvent.data,
                  stepIndex,
                  type: 'stream_retry',
                });

                await sleep(delayMs);

                if (await isOperationInterrupted(ctx)) {
                  throw error;
                }

                continue;
              }

              if (error instanceof ModelEmptyError && error.diagnostics) {
                error.diagnostics.retryBudget = retryBudget;
                error.diagnostics.retryEvents = events
                  .filter((event) => event.type === 'stream_retry')
                  .map((event) => event.data);
              }

              // Cancel/interrupt path: when the user stops mid-stream, the model-runtime
              // stream is aborted before reaching the post-stream finalize,
              // so the DB row remains a LOADING_FLAT placeholder. Without this fix,
              // agent_runtime_end would push the placeholder as the source-of-truth
              // to the client, clobbering the streamed content accumulated in memory.
              // We persist whatever partial content the stream callbacks already
              // accumulated so that reload/end snapshots reflect actual progress.
              if (interrupted) {
                await persistInterruptedServerCallLlmResult({
                  assistantMessageId: assistantMessageItem.id,
                  currentStepSpeed: llmAttempt.speed,
                  currentStepUsage: llmAttempt.usage,
                  messageModel: ctx.messageModel,
                  operationLogId,
                  streamOutput: llmAttempt,
                  toolsCalling: llmAttempt.toolsCalling,
                });
              }

              throw error;
            }
          }

          throw new Error('LLM execution retry loop exited unexpectedly');
        });
      } catch (error) {
        chatSpan.recordException(error as Error);
        chatSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        chatSpan.end();
      }
    } catch (error) {
      // Publish error event
      await streamManager.publishStreamEvent(operationId, {
        data: formatErrorEventData(error, 'llm_execution'),
        stepIndex,
        type: 'error',
      });

      console.error(
        `[StreamingLLMExecutor][${operationId}:${stepIndex}] LLM execution failed:`,
        error,
      );
      throw error;
    }
  }
}

export const executeServerCallLlmTurn = (
  ctx: RuntimeExecutorContext,
  prepared: ServerCallLlmExecutionContext,
): Promise<InstructionExecutionResult> => new ServerCallLlmTurn(ctx, prepared).execute();
