import type { ConversationContext } from '@lobechat/types';

import type { AgentStreamEvent, StreamChunkData } from '@/libs/agent-stream';
import type { ChatStore } from '@/store/chat/store';

/**
 * Creates a handler function that processes Agent Gateway events
 * and maps them to the chat store's message update actions.
 *
 * This replaces the client-side agent loop when running in server mode.
 */
export const createGatewayEventHandler = (
  get: () => ChatStore,
  params: {
    assistantMessageId: string;
    context: ConversationContext;
    operationId: string;
  },
) => {
  const { assistantMessageId, context } = params;

  // Accumulated content from stream chunks
  let accumulatedContent = '';
  let accumulatedReasoning = '';

  return (event: AgentStreamEvent) => {
    switch (event.type) {
      case 'stream_chunk': {
        const data = event.data as StreamChunkData | undefined;
        if (!data) break;

        if (data.chunkType === 'text' && data.content) {
          accumulatedContent += data.content;
          get().internal_dispatchMessage({
            id: assistantMessageId,
            type: 'updateMessage',
            value: { content: accumulatedContent },
          });
        }

        if (data.chunkType === 'reasoning' && data.reasoning) {
          accumulatedReasoning += data.reasoning;
          get().internal_dispatchMessage({
            id: assistantMessageId,
            type: 'updateMessage',
            value: { reasoning: { content: accumulatedReasoning } },
          });
        }

        if (data.chunkType === 'tools_calling' && data.toolsCalling) {
          get().internal_dispatchMessage({
            id: assistantMessageId,
            type: 'updateMessage',
            value: { tools: data.toolsCalling },
          });
        }
        break;
      }

      case 'stream_start': {
        // Reset accumulated content for new stream
        accumulatedContent = '';
        accumulatedReasoning = '';
        get().internal_toggleMessageLoading(true, assistantMessageId);
        break;
      }

      case 'stream_end': {
        get().internal_toggleMessageLoading(false, assistantMessageId);
        break;
      }

      case 'agent_runtime_end': {
        // Refresh messages from server to get the final persisted state
        get().internal_toggleMessageLoading(false, assistantMessageId);
        get().refreshMessages(context).catch(console.error);
        break;
      }

      case 'error': {
        const errorMsg = event.data?.message || event.data?.error || 'Unknown error';
        get().internal_dispatchMessage({
          id: assistantMessageId,
          type: 'updateMessage',
          value: {
            error: { body: { message: errorMsg }, type: 'AgentRuntimeError' },
          },
        });
        get().internal_toggleMessageLoading(false, assistantMessageId);
        break;
      }

      // step_start, step_complete, tool_start, tool_end — no UI action needed for now
      // These can be extended in the future for step progress indicators
    }
  };
};
