import type { ConversationContext } from '@lobechat/types';

import type {
  AgentStreamEvent,
  StepCompleteData,
  StreamChunkData,
  StreamStartData,
} from '@/libs/agent-stream';
import { messageService } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';

/**
 * Fetch messages from DB and replace them in the chat store's dbMessagesMap.
 * This updates the ConversationArea component via React subscription:
 *   dbMessagesMap → ConversationArea (messages prop) → ConversationStore → UI
 */
const fetchAndReplaceMessages = async (get: () => ChatStore, context: ConversationContext) => {
  const messages = await messageService.getMessages(context);
  get().replaceMessages(messages, { context });
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
    operationId: string;
  },
) => {
  const { context, operationId } = params;

  // Dispatch context — ensures internal_dispatchMessage resolves the correct messageMapKey
  const dispatchContext = { operationId };

  // Mutable — switches to new assistant message ID on each stream_start
  let currentAssistantMessageId = params.assistantMessageId;

  // Accumulated content from stream chunks (reset on each stream_start)
  let accumulatedContent = '';
  let accumulatedReasoning = '';

  // Sequential processing queue — ensures stream_chunk waits for stream_start's fetch
  let processingChain: Promise<void> = Promise.resolve();

  const enqueue = (fn: () => Promise<void> | void): void => {
    processingChain = processingChain.then(fn, fn);
  };

  return (event: AgentStreamEvent) => {
    switch (event.type) {
      case 'stream_start': {
        enqueue(async () => {
          const data = event.data as StreamStartData | undefined;

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

          // Fetch from DB so the new message exists in dbMessagesMap before chunks arrive
          await fetchAndReplaceMessages(get, context).catch(console.error);
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
        break;
      }

      case 'tool_end': {
        enqueue(async () => {
          await fetchAndReplaceMessages(get, context).catch(console.error);
        });
        break;
      }

      case 'step_complete': {
        const data = event.data as StepCompleteData | undefined;

        // Refresh on execution_complete to ensure final step state is consistent
        if (data?.phase === 'execution_complete') {
          enqueue(async () => {
            await fetchAndReplaceMessages(get, context).catch(console.error);
          });
        }
        break;
      }

      case 'agent_runtime_end': {
        enqueue(async () => {
          get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);
          get().completeOperation(operationId);
          await fetchAndReplaceMessages(get, context).catch(console.error);
        });
        break;
      }

      case 'error': {
        enqueue(() => {
          const errorMsg = event.data?.message || event.data?.error || 'Unknown error';
          get().internal_dispatchMessage(
            {
              id: currentAssistantMessageId,
              type: 'updateMessage',
              value: {
                error: { body: { message: errorMsg }, type: 'AgentRuntimeError' },
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
