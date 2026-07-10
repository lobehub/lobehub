import type {
  AgentStreamEvent,
  StepCompleteData,
  StreamChunkData,
  StreamStartData,
  ToolEndData,
  ToolExecuteData,
  ToolStartData,
} from '@lobechat/agent-gateway-client';
import type {
  BuiltinToolResult,
  ChatMessageError,
  ConversationContext,
  UIChatMessage,
} from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { isRecord, pickNonEmptyString, toRecord } from '@lobechat/utils/object';

import { messageService } from '@/services/message';
import { emitClientAgentSignalSourceEvent } from '@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge';
import type {
  AgentRunLifecycle,
  RunScope,
} from '@/store/chat/slices/agentRun/actions/lifecycle/types';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import type { ChatStore } from '@/store/chat/store';
import { notifyDesktopHumanApprovalRequired } from '@/store/chat/utils/desktopNotification';

// `agent_runtime_end` reasons that are NOT a clean completion: a mid-stream
// cancel and a deferred-tool park. These must NOT mark the topic unread, and
// must take the non-success branch in `onSessionComplete` so the run clears
// back to 'active' rather than persisting as an unread completion.
const NON_COMPLETION_RUNTIME_END_REASONS = new Set(['interrupted', 'waiting_for_async_tool']);

/**
 * Whether an `agent_runtime_end` event represents a clean completion (vs. a
 * cancel / park). A clean completion is the only ending that should surface an
 * unread badge.
 */
export const isCompletedRuntimeEnd = (reason?: string | null): boolean =>
  !NON_COMPLETION_RUNTIME_END_REASONS.has(reason ?? '');

// Lazy-loaded to break the import cycle:
//   gateway.ts → gatewayEventHandler.ts → executors/index.ts (which pulls in
//   tool client barrels that import `@/store/chat/store`) → chat store
//   creation → `new GatewayActionImpl(...)` while gateway.ts is still
//   mid-evaluation, so the class binding is undefined.
const loadGetExecutor = async () => {
  const mod = await import('@/store/tool/slices/builtin/executors');
  return mod.getExecutor;
};

/**
 * Fetch messages from DB and replace them in the chat store's dbMessagesMap.
 * This updates the ConversationArea component via React subscription:
 *   dbMessagesMap → ConversationArea (messages prop) → ConversationStore → UI
 */
const fetchAndReplaceMessages = async (get: () => ChatStore, context: ConversationContext) => {
  const messages = await messageService.getMessages(context);
  get().replaceMessages(messages, { context });
  return messages;
};

const shouldSkipMessageFetch = (
  event: AgentStreamEvent,
  runtimeType: 'gateway' | 'hetero',
): boolean => runtimeType === 'hetero' && event.data?.skipMessageFetch === true;

const getToolId = (tool: unknown): string | undefined =>
  isRecord(tool) ? pickNonEmptyString(tool.id) : undefined;

const getToolResultMessageId = (tool: unknown): string | undefined =>
  isRecord(tool) ? pickNonEmptyString(tool.result_msg_id) : undefined;

const preserveToolResultMessageIds = (
  toolsCalling: unknown[],
  existingTools: unknown,
): unknown[] => {
  if (!Array.isArray(existingTools)) return toolsCalling;

  const resultMsgIdByToolId = new Map<string, string>();
  for (const tool of existingTools) {
    const toolId = getToolId(tool);
    const resultMsgId = getToolResultMessageId(tool);
    if (toolId && resultMsgId) resultMsgIdByToolId.set(toolId, resultMsgId);
  }

  if (resultMsgIdByToolId.size === 0) return toolsCalling;

  let changed = false;
  const merged = toolsCalling.map((tool) => {
    const toolId = getToolId(tool);
    if (!toolId || getToolResultMessageId(tool)) return tool;

    const resultMsgId = resultMsgIdByToolId.get(toolId);
    if (!resultMsgId || !isRecord(tool)) return tool;

    changed = true;
    return { ...tool, result_msg_id: resultMsgId };
  });

  return changed ? merged : toolsCalling;
};

interface ChatToolPayloadLike {
  apiName?: unknown;
  arguments?: unknown;
  id?: unknown;
  identifier?: unknown;
}

interface ToolPayloadIdentity {
  apiName: string;
  identifier: string;
  params: unknown;
  toolCallId?: string;
}

/**
 * Extract `{ identifier, apiName, params, toolCallId }` from a stream event's
 * tool payload. Returns `undefined` when the payload is malformed so the
 * caller can skip dispatch without throwing.
 */
const readToolPayload = (
  payload: ChatToolPayloadLike | undefined,
): ToolPayloadIdentity | undefined => {
  const identifier = typeof payload?.identifier === 'string' ? payload.identifier : undefined;
  const apiName = typeof payload?.apiName === 'string' ? payload.apiName : undefined;
  if (!identifier || !apiName) return undefined;

  let params: unknown = payload?.arguments;
  if (typeof params === 'string') {
    try {
      params = JSON.parse(params);
    } catch {
      params = {};
    }
  } else if (params == null) {
    params = {};
  }

  const toolCallId = typeof payload?.id === 'string' ? payload.id : undefined;
  return { apiName, identifier, params, toolCallId };
};

/**
 * Route a `tool_start` event to the executor's optional `onBeforeCall` hook so
 * tool packages can react before their own mutations dispatch (e.g.
 * optimistic UI). Fires for both client- and server-runtime tools.
 */
const dispatchOnBeforeCall = async (
  data: ToolStartData | undefined,
  topicId?: string,
): Promise<void> => {
  const payload = data?.toolCalling as ChatToolPayloadLike | undefined;
  const identity = readToolPayload(payload);
  if (!identity) return;

  const getExecutor = await loadGetExecutor();
  const executor = getExecutor(identity.identifier);
  if (!executor?.onBeforeCall) return;

  await executor.onBeforeCall({ ...identity, topicId });
};

/**
 * Real gateway `tool_end` events ship `data.payload` as the
 * `{ parentMessageId, toolCalling }` wrapper, NOT a flat `ChatToolPayload`
 * (see `src/server/modules/AgentRuntime/RuntimeExecutors.ts` — both the
 * single-tool and batch publish sites). Unwrap defensively, falling back to
 * the flat shape so we tolerate test fixtures / future emission paths that
 * pass the payload directly.
 */
const unwrapToolPayload = (raw: unknown): ChatToolPayloadLike | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const wrapper = raw as { toolCalling?: unknown };
  if (wrapper.toolCalling && typeof wrapper.toolCalling === 'object') {
    return wrapper.toolCalling as ChatToolPayloadLike;
  }
  return raw as ChatToolPayloadLike;
};

/**
 * Route a `tool_end` event to the executor's optional `onAfterCall` hook so
 * tool packages can react to their own mutations (e.g. invalidate store
 * caches) regardless of whether the tool ran client- or server-side.
 */
const dispatchOnAfterCall = async (
  data: ToolEndData | undefined,
  topicId?: string,
): Promise<void> => {
  const identity = readToolPayload(unwrapToolPayload(data?.payload));
  if (!identity) return;

  const getExecutor = await loadGetExecutor();
  const executor = getExecutor(identity.identifier);
  if (!executor?.onAfterCall) return;

  await executor.onAfterCall({
    ...identity,
    result: (data?.result ?? {}) as BuiltinToolResult,
    topicId,
  });
};

type GatewayMessageLike = { id: string; role?: string };
type HeteroStreamStartData = StreamStartData & { newStep?: boolean };

const findNextAssistantMessageId = (
  messages: GatewayMessageLike[] | undefined,
  currentAssistantMessageId: string,
) => {
  if (!messages?.length) return;

  const currentIndex = messages.findIndex((message) => message.id === currentAssistantMessageId);
  if (currentIndex === -1) return;

  for (let index = currentIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'assistant') {
      return message.id;
    }
  }
};

const isErrorType = (value: unknown): value is ChatMessageError['type'] =>
  typeof value === 'string' || typeof value === 'number';

const getMessageFromErrorData = (data: unknown): string | undefined => {
  if (!isRecord(data)) return undefined;

  const message = pickNonEmptyString(data.message);
  if (message) return message;

  const error = data.error;
  const errorString = pickNonEmptyString(error);
  if (errorString) return errorString;
  if (isRecord(error)) {
    const errorMessage = pickNonEmptyString(error.message);
    if (errorMessage) return errorMessage;

    const nestedError = error.error;
    if (isRecord(nestedError)) {
      const nestedMessage = pickNonEmptyString(nestedError.message);
      if (nestedMessage) return nestedMessage;
    }
  }

  const responseBody = data._responseBody;
  const responseBodyMessage = getMessageFromErrorData(responseBody);
  if (responseBodyMessage) return responseBodyMessage;

  const body = data.body;
  if (isRecord(body)) {
    const bodyMessage = pickNonEmptyString(body.message);
    if (bodyMessage) return bodyMessage;
  }
};

const mergeGatewayPayloadError = (
  sourceBody: Record<string, unknown>,
  payloadError: unknown,
): Record<string, unknown> => {
  if (payloadError === undefined) return sourceBody;
  if (!('error' in sourceBody)) return { ...sourceBody, error: payloadError };
  if (isRecord(sourceBody.error) && isRecord(payloadError)) {
    return { ...sourceBody, error: { ...payloadError, ...sourceBody.error } };
  }
  return sourceBody;
};

const buildGatewayRuntimeErrorBody = (
  data: Record<string, unknown>,
  message: string,
): Record<string, unknown> => {
  const body = toRecord(data.body);
  const responseBody = toRecord(data._responseBody);
  const errorBody = toRecord(data.error);
  const sourceBody = body ?? responseBody ?? errorBody ?? {};
  const shouldMergePayloadError = body === undefined && data._responseBody !== undefined;
  const mergedBody = shouldMergePayloadError
    ? mergeGatewayPayloadError(sourceBody, data.error)
    : sourceBody;

  return {
    ...mergedBody,
    ...(data.budget === undefined || 'budget' in mergedBody ? {} : { budget: data.budget }),
    ...(typeof data.provider === 'string' && !('provider' in mergedBody)
      ? { provider: data.provider }
      : {}),
    ...('message' in mergedBody ? {} : { message }),
  };
};

const toChatMessageError = (data: unknown): ChatMessageError => {
  if (isRecord(data) && isErrorType(data.type)) {
    const message =
      typeof data.message === 'string' && data.message
        ? data.message
        : getMessageFromErrorData({ body: data.body });

    return {
      ...data,
      ...(message ? { message } : {}),
      type: data.type,
    };
  }

  // Gateway realtime error events can carry the model-runtime payload shape
  // (`errorType` + `error`) before the terminal DB message is refreshed. Treat
  // it as the same semantic error instead of falling back to AgentRuntimeError.
  if (isRecord(data) && isErrorType(data.errorType)) {
    const message = getMessageFromErrorData(data) || String(data.errorType);

    return {
      body: buildGatewayRuntimeErrorBody(data, message),
      message,
      type: data.errorType,
    };
  }

  const message = getMessageFromErrorData(data) || 'Unknown error';

  return {
    body: { message },
    message,
    type: AgentRuntimeErrorType.AgentRuntimeError,
  };
};

/**
 * Creates a handler function that processes Agent Gateway events
 * and maps them to the chat store's message update actions.
 *
 * Supports multi-step agent execution (LLM → tool calls → next LLM → ...)
 * using a hybrid approach:
 * - Current LLM step: real-time streaming via stream_chunk
 * - Step transitions: fetchAndReplaceMessages from DB at stream_start / tool_end / step_complete
 *
 * The handler queues incoming events and processes them sequentially,
 * ensuring that stream_chunk waits for stream_start's DB fetch to resolve
 * before dispatching updates.
 */
export const createGatewayEventHandler = (
  get: () => ChatStore,
  params: {
    assistantMessageId: string;
    context: ConversationContext;
    /**
     * Server-side operation id — used to look up the `AgentStreamClient` in
     * `gatewayConnections` so we can `sendToolResult` back over the same WS.
     * Defaults to `operationId` when the caller does not distinguish the two.
     */
    gatewayOperationId?: string;
    operationId: string;
    /**
     * Shared run lifecycle for this run, assembled by the caller (gateway.ts).
     * Only the gateway transport supplies it — it drives the terminal lifecycle
     * (completeRun / afterRunComplete) here. hetero reuses this handler ONLY for
     * per-event message reconciliation; its executor owns the terminal lifecycle
     * (completeRun + notification + queue drain) in `onComplete`, so it omits this
     * and the handler must NOT double-complete or double-notify.
     *
     * Injected (not built here) to avoid statically importing `buildRunLifecycle`
     * — which pulls `@/store/chat/store` into this module's evaluation and breaks
     * the gateway.ts → gatewayEventHandler import cycle.
     */
    runLifecycle?: AgentRunLifecycle;
    /**
     * Which transport owns this handler. `gateway` (default) drives the terminal
     * run lifecycle here (completeRun / afterRunComplete). `hetero` reuses the
     * handler ONLY for per-event message reconciliation.
     */
    runtimeType?: 'gateway' | 'hetero';
  },
) => {
  const { context, operationId, runLifecycle } = params;
  const gatewayOperationId = params.gatewayOperationId ?? operationId;
  const runtimeType = params.runtimeType ?? 'gateway';

  const runScope: RunScope = context.scope === 'sub_agent' ? 'sub_agent' : 'top_level';
  const lifecycleEventBase = {
    context,
    operationId,
    runId: operationId,
    runScope,
    runtimeType: 'gateway' as const,
  };

  // Dispatch context — ensures internal_dispatchMessage resolves the correct messageMapKey
  const dispatchContext = { operationId };

  // Mutable — switches to new assistant message ID on each stream_start
  let currentAssistantMessageId = params.assistantMessageId;
  let terminalState: 'completed' | 'error' | undefined;

  // Accumulated content from stream chunks (reset on each stream_start)
  let accumulatedContent = '';
  let accumulatedReasoning = '';

  // Tracks whether any server-confirmed state has actually arrived
  // (server-assigned assistant id, streamed text/reasoning/tools, or a SoT
  // uiMessages snapshot). Used by `agent_runtime_end` to decide between
  // preserving in-memory streamed content (when interrupted MID-stream) vs.
  // falling back to a DB refetch (when interrupted BEFORE any server state
  // landed — otherwise the optimistic `tmp_*` placeholder messages stay in
  // the store indefinitely).
  let hasStreamedContent = false;

  // Active reasoning sub-op id. Mirrors the LLM `StreamingHandler` lifecycle so
  // `isMessageInReasoning(messageId)` (which drives the Thinking UI's
  // "thinking..." title + auto-expand) flips to `true` while thinking is
  // streaming. Without this, heterogeneous server-mode messages render the
  // collapsed "completed" state from the first chunk on.
  let reasoningOperationId: string | undefined;

  const startReasoningIfNeeded = () => {
    if (reasoningOperationId) return;
    const { operationId: reasoningOpId } = get().startOperation({
      context: { ...context, messageId: currentAssistantMessageId },
      parentOperationId: operationId,
      type: 'reasoning',
    });
    get().associateMessageWithOperation(currentAssistantMessageId, reasoningOpId);
    reasoningOperationId = reasoningOpId;
  };

  const endReasoningIfNeeded = () => {
    if (!reasoningOperationId) return;
    get().completeOperation(reasoningOperationId);
    reasoningOperationId = undefined;
  };

  // Sequential processing queue — ensures stream_chunk waits for stream_start's fetch
  let processingChain: Promise<void> = Promise.resolve();

  const enqueue = (fn: () => Promise<void> | void): void => {
    processingChain = processingChain.then(fn, fn);
  };

  return (event: AgentStreamEvent) => {
    if (terminalState) return;

    // Subagent (`Agent`/`Task`) inner-tool events are tagged `data.subagent` and
    // belong to an isolation Thread. This handler is main-agent-only, so
    // dispatching them leaks the subagent's tools into the parent bubble
    // mid-stream until the terminal fetch corrects it. The local executor drops
    // them before forwarding; the gateway path doesn't. (DB is unaffected.)
    if ((event.data as { subagent?: unknown } | undefined)?.subagent) return;

    if (event.type === 'agent_runtime_end' || event.type === 'error') {
      terminalState = event.type === 'error' ? 'error' : 'completed';
    }

    switch (event.type) {
      case 'stream_start': {
        enqueue(async () => {
          const data = event.data as HeteroStreamStartData | undefined;

          const newAssistantMessageId = data?.assistantMessage?.id;

          // Switch to the new assistant message created by the server for this step
          if (newAssistantMessageId) {
            currentAssistantMessageId = newAssistantMessageId;
            // Associate the new message with the operation so UI shows generating state
            get().associateMessageWithOperation(currentAssistantMessageId, operationId);
            // Server-confirmed assistant id is durable state — preserve it on
            // interrupt instead of falling back to a placeholder-clobbering refetch.
            hasStreamedContent = true;

            // The step_start uiMessages snapshot is resolved BEFORE the server
            // creates this step's assistant row, so for every step after the
            // first the message is NOT in the store yet. `updateMessage`
            // dispatches on a missing id are silent no-ops, so without an
            // insert here the whole step renders nothing until the next DB
            // refetch — and the final step has none before agent_runtime_end,
            // which is how "loading cleared but no text" happened (LOBE-11501).
            const stored = dbMessageSelectors.getDbMessageById(newAssistantMessageId)(get());
            if (!stored) {
              const seed = data?.assistantMessage;
              if (seed?.role) {
                // Newer servers ship the message seed on stream_start — insert
                // the shell locally so chunks land immediately, zero roundtrips.
                get().internal_dispatchMessage(
                  {
                    id: newAssistantMessageId,
                    type: 'createMessage',
                    value: {
                      agentId: seed.agentId ?? context.agentId,
                      content: '',
                      groupId: seed.groupId ?? undefined,
                      model: seed.model ?? data?.model,
                      parentId: seed.parentId ?? undefined,
                      provider: seed.provider ?? data?.provider,
                      role: 'assistant',
                      threadId: seed.threadId ?? undefined,
                      topicId: seed.topicId ?? context.topicId ?? undefined,
                    },
                  },
                  dispatchContext,
                );
              } else {
                // Older servers send only `{ id }` — fall back to a DB read.
                // The row is inserted before stream_start is published, so the
                // fetch is guaranteed to bring it into the store.
                await fetchAndReplaceMessages(get, context).catch(console.error);
              }
            }
          }

          // Close any reasoning op carried over from the previous step.
          // Safe to run after the assistant-id swap: the op was started with
          // its own messageId context, so completion doesn't depend on the
          // current id.
          endReasoningIfNeeded();

          // Reset accumulators for the new stream
          accumulatedContent = '';
          accumulatedReasoning = '';
          get().updateOperationMetadata(operationId, { visibleLoadingDone: false });

          // Native gateway streams carry `assistantMessage.id` directly on
          // stream_start and the shell-insert above guarantees a valid chunk
          // target in `dbMessagesMap`, so they skip this DB read — that skip
          // is what un-blocks the enqueue chain so live chunks can land
          // mid-stream.
          //
          // Hetero CLI adapters (Claude Code / Codex) never set
          // `assistantMessage.id` on stream_start, so the DB read stays
          // mandatory for them — it (a) pulls the executor-created
          // placeholder into `dbMessagesMap` so subsequent chunks can
          // dispatch to it, and (b) resolves the next-step assistant id for
          // the `newStep` fallback.
          if (!newAssistantMessageId) {
            const messages = await fetchAndReplaceMessages(get, context).catch((error) => {
              console.error(error);
              return undefined;
            });

            if (data?.newStep) {
              const resolvedAssistantMessageId = findNextAssistantMessageId(
                messages as GatewayMessageLike[] | undefined,
                currentAssistantMessageId,
              );

              if (resolvedAssistantMessageId) {
                currentAssistantMessageId = resolvedAssistantMessageId;
                get().associateMessageWithOperation(currentAssistantMessageId, operationId);
              }
            }
          }

          void emitClientAgentSignalSourceEvent({
            payload: {
              agentId: context.agentId,
              ...(currentAssistantMessageId
                ? {
                    anchorMessageId: currentAssistantMessageId,
                    assistantMessageId: currentAssistantMessageId,
                  }
                : {}),
              operationId,
              stepIndex: event.stepIndex,
              topicId: context.topicId ?? undefined,
            },
            sourceId: `${operationId}:gateway:start:${event.stepIndex}`,
            sourceType: 'client.gateway.stream_start',
          });
        });
        break;
      }

      case 'stream_chunk': {
        enqueue(() => {
          const data = event.data as StreamChunkData | undefined;
          if (!data) return;

          if (data.chunkType === 'text' && data.content) {
            // Text after reasoning marks the end of the thinking pass — see
            // `StreamingHandler.handleText` for the same transition.
            endReasoningIfNeeded();
            accumulatedContent += data.content;
            hasStreamedContent = true;
            get().internal_dispatchMessage(
              {
                id: currentAssistantMessageId,
                type: 'updateMessage',
                value: { content: accumulatedContent },
              },
              dispatchContext,
            );
          }

          if (data.chunkType === 'reasoning' && data.reasoning) {
            startReasoningIfNeeded();
            accumulatedReasoning += data.reasoning;
            hasStreamedContent = true;
            get().internal_dispatchMessage(
              {
                id: currentAssistantMessageId,
                type: 'updateMessage',
                value: { reasoning: { content: accumulatedReasoning } },
              },
              dispatchContext,
            );
          }

          if (data.chunkType === 'tools_calling' && data.toolsCalling) {
            endReasoningIfNeeded();
            hasStreamedContent = true;
            const toolsCalling = preserveToolResultMessageIds(
              data.toolsCalling as unknown[],
              dbMessageSelectors.getDbMessageById(currentAssistantMessageId)(get())?.tools,
            ) as NonNullable<StreamChunkData['toolsCalling']>;

            get().internal_dispatchMessage(
              {
                id: currentAssistantMessageId,
                type: 'updateMessage',
                value: { tools: toolsCalling },
              },
              dispatchContext,
            );

            // Drive tool calling animation
            get().internal_toggleToolCallingStreaming(
              currentAssistantMessageId,
              toolsCalling.map(() => true),
            );

            // If the server attached a `toolMessageIds` map, it has persisted
            // pending tool messages (human approval path). Fetch the latest
            // messages so ApprovalActions can read them by id instead of
            // waiting for `agent_runtime_end` (which won't fire while paused
            // in `waiting_for_human`).
            if ((data as any).toolMessageIds) {
              fetchAndReplaceMessages(get, context).catch(console.error);
            }
          }
        });
        break;
      }

      case 'stream_end': {
        enqueue(() => {
          const data = toRecord(event.data);
          const finalContent = pickNonEmptyString(data?.finalContent);
          if (finalContent !== undefined) {
            // Example: reasoning-only answers stream as reasoning chunks, then
            // the server promotes that text into stream_end.finalContent. Apply
            // it before ending reasoning so visible_output_end cannot leave an
            // empty completed assistant bubble while waiting for terminal SoT.
            accumulatedContent = finalContent;
            hasStreamedContent = true;
            get().internal_dispatchMessage(
              {
                id: currentAssistantMessageId,
                type: 'updateMessage',
                value: { content: accumulatedContent },
              },
              dispatchContext,
            );
          }
          get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);
          endReasoningIfNeeded();
        });
        break;
      }

      case 'visible_output_end': {
        enqueue(() => {
          // Guard: only clear visible loading when the streamed content has
          // actually landed in the store. If the message shell is missing (or
          // text streamed but never applied), clearing here would show
          // "loading done" with the answer still invisible (LOBE-11501) —
          // skip the hint instead and let agent_runtime_end reconcile content
          // and loading in the same frame, i.e. the pre-early-hint behavior.
          const stored = dbMessageSelectors.getDbMessageById(currentAssistantMessageId)(get());
          if (!stored || (accumulatedContent && !stored.content)) return;

          get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);
          endReasoningIfNeeded();
          // Example: CC/Codex may emit stream_end -> stream_start(newStep) for
          // assistant-assistant transitions. Only this explicit producer signal
          // means visible output is done; the operation still waits for
          // agent_runtime_end to preserve terminal side-effect ordering.
          get().updateOperationMetadata(operationId, { visibleLoadingDone: true });
          // From here the sidebar item stops showing the running spinner (the
          // answer is visibly complete) and — when the user isn't viewing the
          // topic — shows the unread dot instead, ahead of markTopicUnread's
          // persisted 'unread' at the terminal. See `isRunningTailUnread` in
          // the sidebar topic Item.
        });
        break;
      }

      case 'tool_start': {
        // Server creates tool messages in DB.
        // Loading is already active from stream_start (not cleared by stream_end).
        const data = event.data as ToolStartData | undefined;
        enqueue(async () => {
          await dispatchOnBeforeCall(data, context.topicId ?? undefined).catch(console.error);
        });
        break;
      }

      case 'step_start': {
        const data = event.data as {
          pendingToolsCalling?: unknown[];
          phase?: string;
          requiresApproval?: boolean;
          uiMessages?: UIChatMessage[];
        };

        // The server's stepIndex is the authoritative step counter — mirror it
        // onto the operation so step-based UI (OpStatusTray) stays correct
        // even across page-refresh reconnects.
        if (typeof event.stepIndex === 'number') {
          get().updateOperationMetadata(operationId, { stepCount: event.stepIndex + 1 });
        }

        // Server attaches the canonical UIChatMessage[] snapshot at every
        // step boundary (agent-runtime #15152). Use it as Source of Truth
        // instead of issuing a DB refetch — the refetch returns a stale
        // assistant placeholder while DB fan-out is still in flight, which
        // clobbers the in-memory streamed assistantGroup.
        if (Array.isArray(data?.uiMessages)) {
          get().replaceMessages(data.uiMessages, { action: 'gateway/step_start', context });
        }

        if (data?.phase === 'human_approval' && data.requiresApproval && data.pendingToolsCalling) {
          void notifyDesktopHumanApprovalRequired(get, context);
          // Persist the explicit "needs user input" marker so the sidebar swaps
          // the running spinner for the hand icon across reloads.
          if (context.topicId) {
            const statusWrite = get().updateTopicStatus?.({
              agentId: context.agentId,
              groupId: context.groupId,
              ...(context.scope === 'group' || context.scope === 'group_agent'
                ? { scope: context.scope }
                : {}),
              status: 'waitingForHuman',
              topicId: context.topicId,
            });
            void statusWrite?.catch((error) => {
              console.error('[gatewayEventHandler] updateTopicStatus failed:', error);
            });
          }
        }

        break;
      }

      case 'tool_execute': {
        // Fire-and-forget: the client-side tool may take a long time, and we
        // must keep processing other events (stream_chunk, tool_end, etc.) on
        // the same WebSocket. `internal_executeClientTool` guarantees it never
        // throws and always sends exactly one `tool_result` back.
        //
        // Use `gatewayOperationId` (server-side id, the key under
        // `gatewayConnections`) so the action can look up the WS to reply on
        // — NOT the local `operationId` used for `dispatchContext`.
        const data = event.data as ToolExecuteData | undefined;
        if (!data) break;
        void get().internal_executeClientTool(data, { operationId: gatewayOperationId });
        break;
      }

      case 'tool_end': {
        const data = event.data as ToolEndData | undefined;
        enqueue(async () => {
          const maybeRefresh = shouldSkipMessageFetch(event, runtimeType)
            ? Promise.resolve()
            : fetchAndReplaceMessages(get, context).catch(console.error);
          await Promise.all([
            maybeRefresh,
            dispatchOnAfterCall(data, context.topicId ?? undefined).catch(console.error),
          ]);
        });
        break;
      }

      case 'step_complete': {
        const data = event.data as StepCompleteData | undefined;

        // Refresh on execution_complete to ensure final step state is consistent
        if (data?.phase === 'execution_complete') {
          enqueue(async () => {
            void emitClientAgentSignalSourceEvent({
              payload: {
                agentId: context.agentId,
                operationId,
                stepIndex: event.stepIndex,
                topicId: context.topicId ?? undefined,
              },
              sourceId: `${operationId}:gateway:step_complete:${event.stepIndex}`,
              sourceType: 'client.gateway.step_complete',
            });
            if (!shouldSkipMessageFetch(event, runtimeType)) {
              await fetchAndReplaceMessages(get, context).catch(console.error);
            }
          });
        }
        break;
      }

      case 'agent_runtime_end': {
        enqueue(async () => {
          const data = event.data as { reason?: string; uiMessages?: UIChatMessage[] } | undefined;

          void emitClientAgentSignalSourceEvent({
            payload: {
              agentId: context.agentId,
              ...(currentAssistantMessageId
                ? {
                    anchorMessageId: currentAssistantMessageId,
                    assistantMessageId: currentAssistantMessageId,
                  }
                : {}),
              operationId,
              topicId: context.topicId ?? undefined,
            },
            sourceId: `${operationId}:gateway:runtime_end`,
            sourceType: 'client.gateway.runtime_end',
          });
          get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);
          endReasoningIfNeeded();

          // Reconcile messages FIRST so the terminal run lifecycle's notification
          // (afterRunComplete) can read the final assistant content from the store.
          //
          // Terminal step has no later step_start to carry SoT — server
          // pushes the canonical snapshot directly on this event. Fall back
          // to a DB refetch only if the snapshot is absent (older server
          // builds, or push-event delivery edge cases).
          if (Array.isArray(data?.uiMessages)) {
            get().replaceMessages(data.uiMessages, {
              action: 'gateway/agent_runtime_end',
              context,
            });
          } else if (
            (data?.reason === 'interrupted' || data?.reason === 'waiting_for_async_tool') &&
            hasStreamedContent
          ) {
            // MID-stream cancel, or a deferred-tool pause
            // (`waiting_for_async_tool`). The server's
            // `AgentRuntimeCoordinator.resolveUiMessages` omits uiMessages
            // for both statuses precisely so we can preserve the
            // in-memory streamed content here. The executor's partial-
            // finalize catch writes the real content to DB asynchronously,
            // but it may not be durable yet — refetching here would race
            // against that update and clobber the streamed content with
            // the LOADING_FLAT placeholder. Keep what we have; the next
            // explicit refresh (route change, user-driven mutate) picks
            // up the finalized partial content from DB.
            //
            // The `hasStreamedContent` guard limits this skip to the case
            // where server state actually landed (server-assigned assistant
            // id from stream_start OR any chunk dispatched). If cancel
            // arrives BEFORE any stream activity, the optimistic `tmp_*`
            // messages are the only in-memory state and they need the
            // refetch to be reconciled with the server-side rows.
          } else {
            await fetchAndReplaceMessages(get, context).catch(console.error);
          }

          // Terminal run lifecycle. `isCompletedRuntimeEnd` is the clean-vs-not
          // gate (a mid-stream cancel 'interrupted' or deferred-tool park
          // 'waiting_for_async_tool' is NOT a clean completion):
          //   • completed → completeRun completes the op, marks the topic unread,
          //     drains the input queue, then afterRunComplete fires the desktop
          //     notification (skipped if a queued follow-up was scheduled).
          //   • cancelled → completeRun only completes the op (no unread badge,
          //     no queue drain, no notification) — same as the old inline path.
          if (runtimeType === 'gateway' && runLifecycle) {
            const status = isCompletedRuntimeEnd(data?.reason) ? 'completed' : 'cancelled';
            const { requeued } = await runLifecycle.completeRun({
              ...lifecycleEventBase,
              status,
            });
            if (!requeued && status === 'completed') {
              await runLifecycle.afterRunComplete({ ...lifecycleEventBase, status });
            }
          } else {
            // hetero reuses this handler only for message reconciliation; its
            // executor owns completeRun + notification + queue drain. Complete the
            // op here so loading clears, and mark unread on a clean completion —
            // matching the legacy inline path the hetero executor still relies on.
            get().completeOperation(operationId);
            const completedOp = get().operations[operationId];
            if (completedOp?.context.agentId && isCompletedRuntimeEnd(data?.reason)) {
              get().markTopicUnread({
                agentId: completedOp.context.agentId,
                groupId: completedOp.context.groupId,
                topicId: completedOp.context.topicId,
              });
            }
          }
        });
        break;
      }

      case 'notify_update': {
        // Remote hetero agent (openclaw / hermes) wrote a message to DB via
        // `lh notify`. DB is the source of truth — just refresh the message list.
        enqueue(async () => {
          await fetchAndReplaceMessages(get, context).catch(console.error);
        });
        break;
      }

      case 'error': {
        enqueue(async () => {
          const messageError = toChatMessageError(event.data);
          const errorMessage = messageError.message;

          void emitClientAgentSignalSourceEvent({
            payload: {
              agentId: context.agentId,
              errorMessage,
              operationId,
              topicId: context.topicId ?? undefined,
            },
            sourceId: `${operationId}:gateway:error`,
            sourceType: 'client.gateway.error',
          });

          get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);
          endReasoningIfNeeded();

          // An errored run is a FAILED run, not a completed one — failed runs
          // receive no unread badge, no queue drain, and no notification.
          // For gateway, drive the terminal disposition through the
          // shared lifecycle so the op lands in `failed` (no unread badge, no queue
          // drain, no notification). hetero never forwards `error` to this handler
          // (its executor routes errors through persistTerminalError), but keep the
          // legacy completeOperation for any other caller for safety.
          if (runtimeType === 'gateway' && runLifecycle) {
            await runLifecycle.completeRun({ ...lifecycleEventBase, status: 'failed' });
          } else {
            get().completeOperation(operationId);
          }

          const updateResult = await messageService
            .updateMessageError(currentAssistantMessageId, messageError, {
              agentId: context.agentId,
              groupId: context.groupId,
              threadId: context.threadId,
              topicId: context.topicId,
            })
            .catch(console.error);

          if (updateResult?.success && updateResult.messages) {
            get().replaceMessages(updateResult.messages, { context });
          } else {
            // Fallback when the mutation response doesn't include messages.
            await fetchAndReplaceMessages(get, context).catch(console.error);
          }

          // Then overlay the inline error. This ensures the UI always shows the
          // error even if the server hasn't persisted it into the message yet
          // (the DB fetch would have returned a message with no error field).
          get().internal_dispatchMessage(
            {
              id: currentAssistantMessageId,
              type: 'updateMessage',
              value: {
                error: messageError,
              },
            },
            dispatchContext,
          );
        });
        break;
      }
    }
  };
};
