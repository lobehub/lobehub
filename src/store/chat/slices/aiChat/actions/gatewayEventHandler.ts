import type {
  AgentStreamEvent,
  StepCompleteData,
  StreamChunkData,
  StreamStartData,
  ToolEndData,
  ToolExecuteData,
  ToolStartData,
} from '@lobechat/agent-gateway-client';
import type { BuiltinToolResult, ChatMessageError, ConversationContext } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

import { messageService } from '@/services/message';
import { emitClientAgentSignalSourceEvent } from '@/store/chat/slices/aiChat/actions/agentSignalBridge';
import type { ChatStore } from '@/store/chat/store';
import { notifyDesktopHumanApprovalRequired } from '@/store/chat/utils/desktopNotification';

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
const dispatchOnBeforeCall = async (data: ToolStartData | undefined): Promise<void> => {
  const payload = data?.toolCalling as ChatToolPayloadLike | undefined;
  const identity = readToolPayload(payload);
  if (!identity) return;

  const getExecutor = await loadGetExecutor();
  const executor = getExecutor(identity.identifier);
  if (!executor?.onBeforeCall) return;

  await executor.onBeforeCall(identity);
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
const dispatchOnAfterCall = async (data: ToolEndData | undefined): Promise<void> => {
  const identity = readToolPayload(unwrapToolPayload(data?.payload));
  if (!identity) return;

  const getExecutor = await loadGetExecutor();
  const executor = getExecutor(identity.identifier);
  if (!executor?.onAfterCall) return;

  await executor.onAfterCall({
    ...identity,
    result: (data?.result ?? {}) as BuiltinToolResult,
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

const toChatMessageError = (data: unknown): ChatMessageError => {
  if (typeof data === 'object' && data && 'type' in data && typeof data.type === 'string') {
    const error = data as ChatMessageError;
    return {
      ...error,
      message: error.message || error.body?.message,
    };
  }

  const message =
    typeof data === 'object' && data && 'message' in data && typeof data.message === 'string'
      ? data.message
      : typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Unknown error';

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
  },
) => {
  const { context, operationId } = params;
  const gatewayOperationId = params.gatewayOperationId ?? operationId;

  // Dispatch context — ensures internal_dispatchMessage resolves the correct messageMapKey
  const dispatchContext = { operationId };

  // Mutable — switches to new assistant message ID on each stream_start
  let currentAssistantMessageId = params.assistantMessageId;
  let terminalState: 'completed' | 'error' | undefined;

  // Accumulated content from stream chunks (reset on each stream_start)
  let accumulatedContent = '';
  let accumulatedReasoning = '';

  // Sequential processing queue — ensures stream_chunk waits for stream_start's fetch
  let processingChain: Promise<void> = Promise.resolve();

  const enqueue = (fn: () => Promise<void> | void): void => {
    processingChain = processingChain.then(fn, fn);
  };

  return (event: AgentStreamEvent) => {
    if (terminalState) return;

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
          }

          // Reset accumulators for the new stream
          accumulatedContent = '';
          accumulatedReasoning = '';

          // Heterogeneous CLI adapters emit `stream_start { newStep: true }`
          // without a server-side assistant id. Pull the freshly created step
          // assistant from DB so subsequent live chunks update the RIGHT row
          // instead of appending onto the previous step's assistant.
          const messages = await fetchAndReplaceMessages(get, context).catch((error) => {
            console.error(error);
            return undefined;
          });

          if (!newAssistantMessageId && data?.newStep) {
            const resolvedAssistantMessageId = findNextAssistantMessageId(
              messages as GatewayMessageLike[] | undefined,
              currentAssistantMessageId,
            );

            if (resolvedAssistantMessageId) {
              currentAssistantMessageId = resolvedAssistantMessageId;
              get().associateMessageWithOperation(currentAssistantMessageId, operationId);
            }
          }

          void emitClientAgentSignalSourceEvent({
            payload: {
              agentId: context.agentId,
              ...(currentAssistantMessageId
                ? { assistantMessageId: currentAssistantMessageId }
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
            accumulatedContent += data.content;
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
            accumulatedReasoning += data.reasoning;
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
            get().internal_dispatchMessage(
              {
                id: currentAssistantMessageId,
                type: 'updateMessage',
                value: { tools: data.toolsCalling },
              },
              dispatchContext,
            );

            // Drive tool calling animation
            get().internal_toggleToolCallingStreaming(
              currentAssistantMessageId,
              data.toolsCalling.map(() => true),
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
          // Only clear tool calling streaming — keep message loading active
          // until agent_runtime_end so users don't think the session ended
          // during tool execution gaps between steps
          get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);
        });
        break;
      }

      case 'tool_start': {
        // Server creates tool messages in DB.
        // Loading is already active from stream_start (not cleared by stream_end).
        const data = event.data as ToolStartData | undefined;
        enqueue(async () => {
          await dispatchOnBeforeCall(data).catch(console.error);
        });
        break;
      }

      case 'step_start': {
        const data = event.data as {
          pendingToolsCalling?: unknown[];
          phase?: string;
          requiresApproval?: boolean;
        };

        if (data?.phase === 'human_approval' && data.requiresApproval && data.pendingToolsCalling) {
          void notifyDesktopHumanApprovalRequired(get, context);
          // Persist a paused marker so the sidebar reflects "waiting on user" across reload.
          // Resume back to 'running' is free: approve / reject both spawn a new op via the
          // executor entries, which already write 'running'.
          if (context.topicId) void get().updateTopicStatus?.(context.topicId, 'paused');
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
          await Promise.all([
            fetchAndReplaceMessages(get, context).catch(console.error),
            dispatchOnAfterCall(data).catch(console.error),
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
            await fetchAndReplaceMessages(get, context).catch(console.error);
          });
        }
        break;
      }

      case 'agent_runtime_end': {
        enqueue(async () => {
          void emitClientAgentSignalSourceEvent({
            payload: {
              agentId: context.agentId,
              ...(currentAssistantMessageId
                ? { assistantMessageId: currentAssistantMessageId }
                : {}),
              operationId,
              topicId: context.topicId ?? undefined,
            },
            sourceId: `${operationId}:gateway:runtime_end`,
            sourceType: 'client.gateway.runtime_end',
          });
          get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);
          get().completeOperation(operationId);

          const completedOp = get().operations[operationId];
          if (completedOp?.context.agentId) {
            get().markUnreadCompleted(completedOp.context.agentId, completedOp.context.topicId);
          }

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
          get().completeOperation(operationId);

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
