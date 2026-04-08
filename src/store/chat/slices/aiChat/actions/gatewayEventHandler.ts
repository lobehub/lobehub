import type { ConversationContext } from '@lobechat/types';

import type {
  AgentStreamEvent,
  StepCompleteData,
  StreamChunkData,
  StreamStartData,
} from '@/libs/agent-stream';
import type { ChatStore } from '@/store/chat/store';

/**
 * Creates a handler function that processes Agent Gateway events
 * and maps them to the chat store's message update actions.
 *
 * Supports multi-step agent execution (LLM → tool calls → next LLM → ...)
 * using a hybrid approach:
 * - Current LLM step: real-time streaming via stream_chunk
 * - Step transitions: refreshMessages() from DB at stream_start / tool_end / step_complete
 */
export const createGatewayEventHandler = (
  get: () => ChatStore,
  params: {
    assistantMessageId: string;
    context: ConversationContext;
    operationId: string;
  },
) => {
  const { context } = params;

  // Mutable — switches to new assistant message ID on each stream_start
  let currentAssistantMessageId = params.assistantMessageId;

  // Accumulated content from stream chunks (reset on each stream_start)
  let accumulatedContent = '';
  let accumulatedReasoning = '';

  return (event: AgentStreamEvent) => {
    switch (event.type) {
      case 'stream_start': {
        const data = event.data as StreamStartData | undefined;

        // Switch to the new assistant message created by the server for this step
        if (data?.assistantMessage?.id) {
          currentAssistantMessageId = data.assistantMessage.id;
        }

        // Reset accumulators for the new stream
        accumulatedContent = '';
        accumulatedReasoning = '';

        // Refresh from DB to pick up the new assistant message
        get().refreshMessages(context).catch(console.error);

        get().internal_toggleMessageLoading(true, currentAssistantMessageId);
        break;
      }

      case 'stream_chunk': {
        const data = event.data as StreamChunkData | undefined;
        if (!data) break;

        if (data.chunkType === 'text' && data.content) {
          accumulatedContent += data.content;
          get().internal_dispatchMessage({
            id: currentAssistantMessageId,
            type: 'updateMessage',
            value: { content: accumulatedContent },
          });
        }

        if (data.chunkType === 'reasoning' && data.reasoning) {
          accumulatedReasoning += data.reasoning;
          get().internal_dispatchMessage({
            id: currentAssistantMessageId,
            type: 'updateMessage',
            value: { reasoning: { content: accumulatedReasoning } },
          });
        }

        if (data.chunkType === 'tools_calling' && data.toolsCalling) {
          get().internal_dispatchMessage({
            id: currentAssistantMessageId,
            type: 'updateMessage',
            value: { tools: data.toolsCalling },
          });

          // Drive tool calling animation
          get().internal_toggleToolCallingStreaming(
            currentAssistantMessageId,
            data.toolsCalling.map(() => true),
          );
        }
        break;
      }

      case 'stream_end': {
        get().internal_toggleMessageLoading(false, currentAssistantMessageId);

        // Clear tool calling streaming animation
        get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);
        break;
      }

      case 'tool_start': {
        // No client-side action needed — server creates tool messages in DB.
        // They will appear when tool_end triggers refreshMessages.
        break;
      }

      case 'tool_end': {
        // Refresh from DB to pick up tool execution results
        get().refreshMessages(context).catch(console.error);
        break;
      }

      case 'step_complete': {
        const data = event.data as StepCompleteData | undefined;

        // Refresh on execution_complete to ensure final step state is consistent
        if (data?.phase === 'execution_complete') {
          get().refreshMessages(context).catch(console.error);
        }
        break;
      }

      case 'agent_runtime_end': {
        // Final refresh to get the complete persisted state
        get().internal_toggleMessageLoading(false, currentAssistantMessageId);
        get().refreshMessages(context).catch(console.error);
        break;
      }

      case 'error': {
        const errorMsg = event.data?.message || event.data?.error || 'Unknown error';
        get().internal_dispatchMessage({
          id: currentAssistantMessageId,
          type: 'updateMessage',
          value: {
            error: { body: { message: errorMsg }, type: 'AgentRuntimeError' },
          },
        });
        get().internal_toggleMessageLoading(false, currentAssistantMessageId);
        break;
      }
    }
  };
};
