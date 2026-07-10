import {
  type AgentEvent,
  type AgentInstruction,
  type CallLLMPayload,
  type GeneralAgentCallLLMResultPayload,
  getLLMRetryDelayMs,
  type InstructionExecutor,
  resolveLLMMaxAttempts,
  resolveLLMRetryBudget,
  shouldRetryLLM,
} from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { type ChatStreamPayload, ModelEmptyError } from '@lobechat/model-runtime';
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

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { type RuntimeExecutorContext } from '../context';
import { isOperationInterrupted, log, sleep } from '../executorHelpers';
import { formatErrorEventData } from '../formatErrorEventData';
import { classifyLLMError } from '../llmErrorClassification';
import { createConversationParentMissingError } from '../messagePersistErrors';
import { createServerCallLlmAttempt } from './serverCallLlmAttempt';
import { buildServerCallLlmContext } from './serverCallLlmContextBuilder';
import {
  finalizeServerCallLlmResult,
  persistInterruptedServerCallLlmResult,
} from './serverCallLlmFinalizer';
import { resolveServerCallLlmTooling, type ServerCallLlmTooling } from './serverCallLlmTooling';

interface PreparedCallLLMContext {
  assistantMessage: { id: string };
  model: string;
  parentId?: string;
  provider: string;
  stepLabel?: string;
  tooling?: ServerCallLlmTooling;
}

const SERVER_LLM_RETRY_POLICY = {
  isEmptyCompletionError: (error: unknown) => error instanceof ModelEmptyError,
  noRetryProviders: [BRANDING_PROVIDER],
};

export const callLlm =
  (ctx: RuntimeExecutorContext, prepared?: PreparedCallLLMContext): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
    const llmPayload = payload as CallLLMPayload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];
    let visibleOutputEndPublishedStepIndex: number | undefined;

    // Fallback to state's modelRuntimeConfig if not in payload
    const model = prepared?.model ?? llmPayload.model ?? state.modelRuntimeConfig?.model;
    const provider =
      prepared?.provider ?? llmPayload.provider ?? state.modelRuntimeConfig?.provider;
    const tooling =
      prepared?.tooling ?? resolveServerCallLlmTooling(ctx, state, llmPayload.allowedToolNames);
    const { resolved, tools } = tooling;

    if (!model || !provider) {
      throw new Error('Model and provider are required for call_llm instruction');
    }

    // Type assertion to ensure payload correctness
    const operationLogId = `${operationId}:${stepIndex}`;

    const stagePrefix = `[${operationLogId}][call_llm]`;

    log(`${stagePrefix} Starting operation`);

    // Get parentId from payload (parentId or parentMessageId depending on payload type)
    const parentId =
      prepared?.parentId ?? llmPayload.parentId ?? (llmPayload as any).parentMessageId;

    // Parent existence preflight ():
    // If the parent was deleted concurrently (e.g. user deleted topic mid-run),
    // assistant message creation below would hit a PG FK violation AFTER we've
    // already done the LLM call and spent tokens. Check first — fail fast,
    // save cost, and surface a typed error the frontend can act on instead of
    // a raw SQL error.
    if (!prepared && parentId) {
      const parentExists = await ctx.messageModel.findById(parentId);
      if (!parentExists) {
        const error = createConversationParentMissingError(parentId);
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(error, 'parent_message_preflight'),
          stepIndex,
          type: 'error',
        });
        throw error;
      }
    }

    // Get or create assistant message
    // If assistantMessageId is provided in payload, use existing message instead of creating new one
    const existingAssistantMessageId = (llmPayload as any).assistantMessageId;
    let assistantMessageItem: { id: string };
    // Seed fields for the client to insert this message into its local store.
    // The step_start uiMessages snapshot is resolved BEFORE this row exists,
    // so the client has no other way to learn about it until the next DB
    // refetch — chunks would silently no-op against the missing id (LOBE-11501).
    let assistantMessageSeed: Record<string, unknown> | undefined;

    if (prepared) {
      assistantMessageItem = prepared.assistantMessage;
      log(`${stagePrefix} Using prepared assistant message: %s`, assistantMessageItem.id);
    } else if (existingAssistantMessageId) {
      // Use existing assistant message (created by execAgent)
      assistantMessageItem = { id: existingAssistantMessageId };
      log(`${stagePrefix} Using existing assistant message: %s`, existingAssistantMessageId);
      const existingRow = await ctx.messageModel.findById(existingAssistantMessageId);
      if (existingRow) assistantMessageSeed = existingRow;
    } else {
      // Create new assistant message (legacy behavior)
      assistantMessageItem = await ctx.messageModel.create({
        agentId: state.metadata!.agentId!,
        content: '',
        groupId: state.metadata?.groupId ?? undefined,
        model,
        parentId,
        provider,
        role: 'assistant',
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      });
      assistantMessageSeed = assistantMessageItem as Record<string, unknown>;
      log(`${stagePrefix} Created new assistant message: %s`, assistantMessageItem.id);
    }

    // Publish stream start event
    const stepLabel = prepared?.stepLabel ?? (instruction as any).stepLabel;
    if (!prepared) {
      await streamManager.publishStreamEvent(operationId, {
        data: {
          // Only the seed fields the client needs — not the whole DB row.
          assistantMessage: {
            id: assistantMessageItem.id,
            ...(assistantMessageSeed && {
              agentId: assistantMessageSeed.agentId,
              groupId: assistantMessageSeed.groupId,
              model: assistantMessageSeed.model,
              parentId: assistantMessageSeed.parentId,
              provider: assistantMessageSeed.provider,
              role: assistantMessageSeed.role,
              threadId: assistantMessageSeed.threadId,
              topicId: assistantMessageSeed.topicId,
            }),
          },
          model,
          provider,
          ...(stepLabel && { stepLabel }),
        },
        stepIndex,
        type: 'stream_start',
      });
    }

    try {
      const {
        preserveThinkingForPayload,
        processedMessages,
        resolvedExtendParams,
        shouldReplayAssistantReasoning,
      } = await buildServerCallLlmContext({
        ctx,
        llmPayload,
        model,
        provider,
        state,
        tooling,
      });

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

      // Initialize ModelRuntime (read user's keyVaults from database)
      const modelRuntime = await initModelRuntimeFromDB(
        ctx.serverDB,
        ctx.userId!,
        provider,
        ctx.workspaceId,
      );

      // Construct ChatStreamPayload
      const stream = ctx.stream ?? true;
      const chatPayload = {
        messages: processedMessages,
        model,
        stream,
        tools,
        // ModelExtendParams keeps provider-specific effort/thinking values as loose
        // strings (e.g. hy3's 'no_think'); the runtime payload narrows them, so cast.
        ...(resolvedExtendParams as Partial<ChatStreamPayload>),
        ...(typeof preserveThinkingForPayload === 'boolean' && {
          preserveThinking: preserveThinkingForPayload,
        }),
      };

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
            const llmAttempt = createServerCallLlmAttempt({
              attempt,
              chatPayload,
              ctx,
              events,
              maxAttempts,
              messageCount: processedMessages.length,
              model,
              modelRuntime,
              onFirstChunk,
              operationLogId,
              provider,
              resolved,
              topicId: state.metadata?.topicId,
              trigger: state.metadata?.trigger,
            });

            try {
              await llmAttempt.execute();
              const {
                answerSalvagedFromReasoning,
                finishReason: currentStepFinishReason,
                grounding,
                imageList,
                speed: currentStepSpeed,
                streamSink,
                toolCalls: tool_calls,
                toolsCalling,
                usage: currentStepUsage,
              } = llmAttempt;

              // Add a complete llm_stream event (including all streaming chunks)
              events.push({
                result: {
                  content: streamSink.content,
                  finishReason: currentStepFinishReason,
                  reasoning: streamSink.thinkingContent,
                  tool_calls,
                  usage: currentStepUsage,
                },
                type: 'llm_result',
              });

              // Publish stream end event
              await streamManager.publishStreamEvent(operationId, {
                data: {
                  finalContent: streamSink.content,
                  grounding,
                  ...(stepLabel && { stepLabel }),
                  imageList: imageList.length > 0 ? imageList : undefined,
                  reasoning: streamSink.thinkingContent || undefined,
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
                streamOutput: streamSink,
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
                    result: { content: streamSink.content, tool_calls },
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
              llmAttempt.streamSink.clearBuffers();

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
                  streamOutput: llmAttempt.streamSink,
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
  };
