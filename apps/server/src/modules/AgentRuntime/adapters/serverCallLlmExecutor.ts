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
  UsageCounter,
} from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { ToolNameResolver } from '@lobechat/context-engine';
import {
  type ChatStreamPayload,
  consumeStreamUntilDone,
  isEmptyModelCompletion,
  ModelEmptyError,
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
import { type ChatToolPayload, type MessageToolCall } from '@lobechat/types';
import { sanitizeToolCallArguments, serializePartsForStorage } from '@lobechat/utils';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { type RuntimeExecutorContext } from '../context';
import { isOperationInterrupted, log, sleep, timing } from '../executorHelpers';
import { formatErrorEventData } from '../formatErrorEventData';
import { classifyLLMError } from '../llmErrorClassification';
import { createConversationParentMissingError } from '../messagePersistErrors';
import { VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY } from '../visibleOutputEnd';
import { buildServerCallLlmContext } from './serverCallLlmContextBuilder';
import { createServerCallLlmStreamSink } from './serverCallLlmStreamSink';
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
            const streamSink = createServerCallLlmStreamSink({
              ctx,
              events,
              operationLogId,
            });
            let toolsCalling: ChatToolPayload[] = [];
            let tool_calls: MessageToolCall[] = [];
            const imageList: any[] = [];
            let grounding: any = null;
            let currentStepUsage: any = undefined;
            let currentStepSpeed: any = undefined;
            let currentStepFinishReason: string | undefined = undefined;
            let streamError: any = undefined;
            // Set when a terminal turn's answer was salvaged from the reasoning
            // channel (see the answer-in-thinking guard below) — surfaced in
            // message metadata for observability.
            let answerSalvagedFromReasoning = false;

            try {
              log(
                `${stagePrefix} calling model-runtime chat (attempt %d/%d, model: %s, messages: %d, tools: %d)`,
                attempt,
                maxAttempts,
                model,
                processedMessages.length,
                tools?.length ?? 0,
              );

              // Call model-runtime chat
              const response = await modelRuntime.chat(chatPayload, {
                callback: {
                  onCompletion: async (data) => {
                    // Capture usage (may or may not include cost)
                    if (data.usage) {
                      currentStepUsage = data.usage;
                    }
                    // Capture performance metrics (tps / ttft / duration / latency)
                    if (data.speed) {
                      currentStepSpeed = data.speed;
                    }
                    // Capture provider's terminal finishReason so soft interrupts
                    // (e.g. Gemini RECITATION / MAX_TOKENS with empty content)
                    // are visible in tracing instead of being silently swallowed.
                    if (data.finishReason) {
                      currentStepFinishReason = data.finishReason;
                    }
                  },
                  onGrounding: async (groundingData) => {
                    log(`[${operationLogId}][grounding] %O`, groundingData);
                    grounding = groundingData;

                    await streamManager.publishStreamChunk(operationId, stepIndex, {
                      chunkType: 'grounding',
                      grounding: groundingData,
                    });
                  },
                  onText: async (text) => {
                    if (firstChunkAt === undefined) {
                      firstChunkAt = Date.now() - llmStartTime;
                    }
                    timing(
                      '[%s] onText received chunk at %d, length: %d',
                      operationLogId,
                      Date.now(),
                      text.length,
                    );
                    await streamSink.appendText(text);
                  },
                  onThinking: async (reasoning) => {
                    if (firstChunkAt === undefined) {
                      firstChunkAt = Date.now() - llmStartTime;
                    }
                    timing(
                      '[%s] onThinking received chunk at %d, length: %d',
                      operationLogId,
                      Date.now(),
                      reasoning.length,
                    );
                    await streamSink.appendThinking(reasoning);
                  },
                  // Gemini 2.5+/3 multimodal streams deliver assistant text and
                  // reasoning as `content_part`/`reasoning_part` events (triggered by
                  // thought parts / thoughtSignature) instead of plain `text`/
                  // `reasoning`. Without these handlers the text is silently dropped:
                  // `onCompletion` still reports usage tokens, so the empty-completion
                  // guard sees outputTokens > 0 and finalizes the turn to a blank
                  // `done`. Mirror onText/onThinking for text parts so streaming,
                  // persistence and tracing all capture the content; upload image
                  // parts to object storage and serialize the multimodal content
                  // (text + image URLs, in order) — never persist raw base64.
                  onContentPart: async (part) => {
                    if (firstChunkAt === undefined) {
                      firstChunkAt = Date.now() - llmStartTime;
                    }

                    await streamSink.appendContentPart(part);
                  },
                  // Some Gemini / Nano Banana image responses arrive via the
                  // legacy single-image `base64_image` event instead of
                  // `content_part` (the Google stream transform emits it when a
                  // response can't be classified as multimodal). Without this
                  // handler the image is silently dropped server-side — never
                  // uploaded, never persisted — and, on channels that omit the
                  // Image response modality, the raw base64 leaks into text and
                  // bloats the context. Mirror the onContentPart image branch:
                  // register a placeholder part, upload to object storage, and
                  // mark the turn multimodal so raw base64 never lands in content.
                  onBase64Image: async ({ image }) => {
                    if (firstChunkAt === undefined) {
                      firstChunkAt = Date.now() - llmStartTime;
                    }

                    await streamSink.appendBase64Image(image);
                  },
                  onReasoningPart: async (part) => {
                    if (firstChunkAt === undefined) {
                      firstChunkAt = Date.now() - llmStartTime;
                    }

                    await streamSink.appendReasoningPart(part);
                  },
                  onToolsCalling: async ({ toolsCalling: raw }) => {
                    const resolvedCalls = new ToolNameResolver().resolve(
                      raw,
                      resolved.promptManifestMap,
                      resolved.tools.map((tool) => tool.function.name),
                    );
                    // Attach source (origin) and executor (dispatch target) for routing.
                    // `arguments` are kept RAW here on purpose so the tool executor can
                    // still detect malformed JSON and return an `INVALID_JSON_ARGUMENTS`
                    // tool-result with the original bad string — that's the
                    // self-reflection signal the model needs to fix its own output.
                    // Sanitization happens later, only at the persist boundaries
                    // (DB write and state.messages push) to protect strict providers
                    // replaying history. See .
                    const payload = resolvedCalls.map((p) => ({
                      ...p,
                      executor: resolved.executorMap?.[p.identifier],
                      source: resolved.sourceMap[p.identifier],
                    }));
                    // log(`[${operationLogId}][toolsCalling]`, payload);
                    toolsCalling = payload;
                    tool_calls = raw;

                    await streamSink.flushTextBuffer();

                    await streamManager.publishStreamChunk(operationId, stepIndex, {
                      chunkType: 'tools_calling',
                      toolsCalling: payload,
                    });
                  },
                  onError: async (errorData) => {
                    streamError = errorData;
                    console.error(`[${operationLogId}][stream_error]`, errorData);
                  },
                },
                metadata: {
                  operationId,
                  topicId: state.metadata?.topicId,
                  trigger: state.metadata?.trigger,
                },
                user: ctx.userId,
              });

              // Consume stream to ensure all callbacks complete execution
              await consumeStreamUntilDone(response);

              // If a stream error was captured via onError callback, throw to propagate the error
              if (streamError) {
                const streamExecutionError = new Error(
                  typeof streamError.message === 'string'
                    ? `LLM stream error: ${streamError.message}`
                    : `LLM stream error: ${JSON.stringify(streamError)}`,
                );
                const { message: _message, ...restStreamError } = streamError as Record<
                  string,
                  unknown
                >;
                Object.assign(streamExecutionError, restStreamError);
                throw streamExecutionError;
              }

              await streamSink.flushTextBuffer();
              await streamSink.flushReasoningBuffer();
              streamSink.clearBuffers();

              // Wait for any model-generated image uploads to finish so the
              // persisted multimodal content references S3 URLs, not base64.
              await streamSink.waitForImageUploads();

              // Empty-completion guard: if the model produced
              // nothing actionable — no content, reasoning, tool calls, images,
              // or output tokens — throw so the retry loop below re-attempts the
              // turn instead of finalizing to `done` with a blank assistant
              // message. Skipped when the user interrupted mid-stream, where an
              // empty turn is expected and must not be retried.
              const reportedOutputTokens =
                currentStepUsage && typeof currentStepUsage === 'object'
                  ? (currentStepUsage as { totalOutputTokens?: unknown }).totalOutputTokens
                  : undefined;

              if (
                isEmptyModelCompletion({
                  content: streamSink.content,
                  imageCount: imageList.length,
                  outputTokens:
                    typeof reportedOutputTokens === 'number' ? reportedOutputTokens : undefined,
                  reasoning: streamSink.thinkingContent,
                  toolCallCount: toolsCalling.length + tool_calls.length,
                }) &&
                !(await isOperationInterrupted(ctx))
              ) {
                log(
                  '[%s] Model returned an empty completion (attempt %d/%d) — throwing ModelEmptyError to retry',
                  operationLogId,
                  attempt,
                  maxAttempts,
                );
                throw new ModelEmptyError(undefined, {
                  attempt,
                  contentLength: streamSink.content.length,
                  finishReason: currentStepFinishReason,
                  imageCount: imageList.length,
                  maxAttempts,
                  model,
                  outputTokens:
                    typeof reportedOutputTokens === 'number' ? reportedOutputTokens : undefined,
                  provider,
                  reasoningLength: streamSink.thinkingContent.length,
                  toolCallCount: toolsCalling.length + tool_calls.length,
                });
              }

              // Answer-in-thinking salvage: some thinking-mode models — notably
              // DeepSeek V4 over the Anthropic-compatible API — occasionally emit
              // the final user-facing answer inside the reasoning channel and stop
              // naturally with an empty text block. The reasoning is then rendered
              // as a collapsed "thinking" panel, so the user sees a blank reply.
              // When a turn ends naturally with no tool calls and no visible
              // content but non-empty text reasoning, promote the reasoning to be
              // the answer. This is a backstop; the primary fix is replaying the
              // real assistant reasoning in history (see modelForcesPreserveThinking
              // above) which sharply reduces how often the model does this.
              const isTerminalNaturalStop =
                currentStepFinishReason === 'end_turn' || currentStepFinishReason === 'stop';
              if (
                isTerminalNaturalStop &&
                toolsCalling.length === 0 &&
                tool_calls.length === 0 &&
                streamSink.content.trim().length === 0 &&
                streamSink.thinkingContent.trim().length > 0 &&
                !streamSink.hasReasoningImages
              ) {
                log(
                  '[%s] answer-in-thinking salvage: promoting %d chars of reasoning to content',
                  operationLogId,
                  streamSink.thinkingContent.length,
                );
                streamSink.content = streamSink.thinkingContent;
                streamSink.thinkingContent = '';
                answerSalvagedFromReasoning = true;
              }

              log(
                `[${operationLogId}] finish model-runtime calling | content: %d chars | reasoning: %d chars | tools: %d | usage: %s`,
                streamSink.content.length,
                streamSink.thinkingContent.length,
                toolsCalling.length,
                currentStepUsage ? 'yes' : 'none',
              );

              if (streamSink.thinkingContent) {
                log(`[${operationLogId}][reasoning]`, streamSink.thinkingContent);
              }
              if (streamSink.content) {
                log(`[${operationLogId}][content]`, streamSink.content);
              }
              if (toolsCalling.length > 0) {
                log(`[${operationLogId}][toolsCalling] `, toolsCalling);
              }

              // Log usage information
              if (currentStepUsage) {
                log(`[${operationLogId}][usage] %O`, currentStepUsage);
              }

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

              // ===== 1. First save original usage to message.metadata =====
              // Determine final content - use serialized parts if has images, otherwise plain text
              const finalContent = streamSink.hasContentImages
                ? serializePartsForStorage(streamSink.contentParts)
                : streamSink.content;

              // Determine final reasoning - handle multimodal reasoning
              let finalReasoning: any = undefined;
              if (streamSink.hasReasoningImages) {
                // Has images, use multimodal format
                finalReasoning = {
                  content: serializePartsForStorage(streamSink.reasoningParts),
                  isMultimodal: true,
                };
              } else if (streamSink.thinkingContent) {
                // Has text from reasoning but no images
                finalReasoning = {
                  content: streamSink.thinkingContent,
                };
              }

              // preserveThinking only gates whether reasoning is replayed into the
              // next LLM payload (state.messages); the DB copy powers UI display
              // after refresh and must always be saved.
              const replayedReasoning = shouldReplayAssistantReasoning ? finalReasoning : undefined;

              try {
                // Build metadata object
                const metadata: Record<string, any> = {};
                if (currentStepUsage && typeof currentStepUsage === 'object') {
                  // Flat fields are kept for backward-compatible readers; `usage`
                  // is the canonical nested shape new readers should consume.
                  Object.assign(metadata, currentStepUsage);
                  metadata.usage = currentStepUsage;
                }
                if (currentStepSpeed && typeof currentStepSpeed === 'object') {
                  Object.assign(metadata, currentStepSpeed);
                  metadata.performance = currentStepSpeed;
                }
                if (streamSink.hasContentImages) {
                  metadata.isMultimodal = true;
                }
                if (answerSalvagedFromReasoning) {
                  metadata.answerSalvagedFromReasoning = true;
                }

                // Sanitize tool_call `arguments` before persisting to DB so malformed
                // JSON (e.g. Qwen emitting `{, ...}`) can't poison future context
                // builds and 400 strict providers like NVIDIA NIM. See .
                const persistedTools =
                  toolsCalling.length > 0
                    ? toolsCalling.map((t) => ({
                        ...t,
                        arguments: sanitizeToolCallArguments(t.arguments),
                      }))
                    : undefined;

                await ctx.messageModel.update(assistantMessageItem.id, {
                  content: finalContent,
                  imageList: imageList.length > 0 ? imageList : undefined,
                  metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
                  reasoning: finalReasoning,
                  search: grounding,
                  tools: persistedTools,
                });
              } catch (error) {
                console.error('[call_llm] Failed to update message:', error);
              }

              // ===== 2. Then accumulate to AgentState =====
              const newState = structuredClone(state);

              // state.messages flows into the next LLM call payload, so entries
              // must be safe for strict-provider history replay:
              //   - drop tool_calls with empty name (undispatchable, and strict
              //     providers 400 on nameless entries)
              //   - coerce malformed JSON `arguments` to valid JSON
              const sanitizedToolCalls =
                tool_calls.length > 0
                  ? tool_calls
                      .filter((tc) => !!tc.function.name)
                      .map((tc) => ({
                        ...tc,
                        function: {
                          ...tc.function,
                          arguments: sanitizeToolCallArguments(tc.function.arguments),
                        },
                      }))
                  : [];
              const stateToolCalls = sanitizedToolCalls.length > 0 ? sanitizedToolCalls : undefined;

              newState.messages.push({
                content: streamSink.content,
                id: assistantMessageItem.id,
                reasoning: replayedReasoning,
                role: 'assistant',
                tool_calls: stateToolCalls,
              });

              if (currentStepUsage) {
                // Use UsageCounter to uniformly accumulate usage and cost
                const { usage, cost } = UsageCounter.accumulateLLM({
                  cost: newState.cost,
                  model: llmPayload.model,
                  modelUsage: currentStepUsage,
                  provider: llmPayload.provider,
                  usage: newState.usage,
                });

                newState.usage = usage;
                if (cost) newState.cost = cost;
              }

              // Propagate stepLabel from instruction to state metadata for hook consumers
              if (stepLabel || visibleOutputEndPublishedStepIndex !== undefined) {
                const stateMetadata = { ...newState.metadata };
                if (stepLabel) stateMetadata._stepLabel = stepLabel;
                if (visibleOutputEndPublishedStepIndex !== undefined) {
                  stateMetadata[VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY] =
                    visibleOutputEndPublishedStepIndex;
                }
                newState.metadata = stateMetadata;
              }

              // Record chat response attributes on the OTel span.
              const usageRecord = currentStepUsage as
                | {
                    inputCachedTokens?: number;
                    outputReasoningTokens?: number;
                    totalInputTokens?: number;
                    totalOutputTokens?: number;
                  }
                | undefined;
              chatSpan.setAttributes(
                buildChatResponseAttributes({
                  cacheReadInputTokens: usageRecord?.inputCachedTokens,
                  finishReasons: currentStepFinishReason ? [currentStepFinishReason] : undefined,
                  inputTokens: usageRecord?.totalInputTokens,
                  outputTokens: usageRecord?.totalOutputTokens,
                  reasoningOutputTokens: usageRecord?.outputReasoningTokens,
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
              streamSink.clearBuffers();

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
              // stream is aborted before reaching the post-stream finalize (line ~1078),
              // so the DB row remains a LOADING_FLAT placeholder. Without this fix,
              // agent_runtime_end would push the placeholder as the source-of-truth
              // to the client, clobbering the streamed content accumulated in memory.
              // We persist whatever partial content the stream callbacks already
              // accumulated so that reload/end snapshots reflect actual progress.
              if (
                interrupted &&
                (streamSink.content || streamSink.thinkingContent || toolsCalling.length > 0)
              ) {
                try {
                  const persistedTools =
                    toolsCalling.length > 0
                      ? toolsCalling.map((t) => ({
                          ...t,
                          arguments: sanitizeToolCallArguments(t.arguments),
                        }))
                      : undefined;
                  const interruptedReasoning = streamSink.thinkingContent
                    ? { content: streamSink.thinkingContent }
                    : undefined;
                  const interruptedMetadata: Record<string, any> = { interruptedMidStream: true };
                  if (currentStepUsage && typeof currentStepUsage === 'object') {
                    Object.assign(interruptedMetadata, currentStepUsage);
                    interruptedMetadata.usage = currentStepUsage;
                  }
                  if (currentStepSpeed && typeof currentStepSpeed === 'object') {
                    Object.assign(interruptedMetadata, currentStepSpeed);
                    interruptedMetadata.performance = currentStepSpeed;
                  }
                  await ctx.messageModel.update(assistantMessageItem.id, {
                    content: streamSink.content,
                    metadata: interruptedMetadata,
                    reasoning: interruptedReasoning,
                    tools: persistedTools,
                  });
                  log(
                    '[%s] Interrupted finalize: persisted partial content (c=%d r=%d tools=%d)',
                    operationLogId,
                    streamSink.content.length,
                    streamSink.thinkingContent.length,
                    toolsCalling.length,
                  );
                } catch (persistErr) {
                  log('[%s] Interrupted finalize update failed: %O', operationLogId, persistErr);
                }
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
