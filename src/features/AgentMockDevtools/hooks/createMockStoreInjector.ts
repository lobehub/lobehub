import type {
  AgentStreamEvent,
  StepCompleteData,
  StreamChunkData,
  ToolExecuteData,
} from '@lobechat/agent-gateway-client';
import type {
  ChatMessageError,
  ChatToolPayload,
  ChatToolPayloadWithResult,
  ConversationContext,
} from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

interface MockStoreInjectorParams {
  assistantMessageId: string;
  context: ConversationContext;
  operationId: string;
}

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

const stringifyResult = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value == null) return '';

  return JSON.stringify(value, null, 2);
};

const toToolPayload = (toolCalling: {
  apiName?: string;
  arguments?: string;
  id?: string;
  identifier?: string;
}): ChatToolPayload => ({
  apiName: toolCalling.apiName ?? 'unknown',
  arguments: toolCalling.arguments ?? '{}',
  id: toolCalling.id ?? `mock-tc-${Date.now()}`,
  identifier: toolCalling.identifier ?? 'mock-tool',
  type: toolCalling.identifier?.startsWith('lobe-') ? 'builtin' : 'default',
});

export const createMockStoreInjector = (get: () => ChatStore, params: MockStoreInjectorParams) => {
  const { assistantMessageId, context, operationId } = params;
  const dispatchContext = { operationId };
  const toolMessageIds = new Map<string, string>();
  let terminalState: 'completed' | 'error' | undefined;
  let accumulatedContent = '';
  let accumulatedReasoning = '';
  let tools: ChatToolPayloadWithResult[] = [];

  const updateAssistantTools = () => {
    get().internal_dispatchMessage(
      {
        id: assistantMessageId,
        type: 'updateMessage',
        value: { tools },
      },
      dispatchContext,
    );
  };

  return (event: AgentStreamEvent) => {
    if (terminalState) return;

    if (event.type === 'agent_runtime_end' || event.type === 'error') {
      terminalState = event.type === 'error' ? 'error' : 'completed';
    }

    switch (event.type) {
      case 'stream_start': {
        accumulatedContent = '';
        accumulatedReasoning = '';
        break;
      }

      case 'stream_chunk': {
        const data = event.data as StreamChunkData | undefined;
        if (!data) break;

        if (data.chunkType === 'text' && data.content) {
          accumulatedContent += data.content;
          get().internal_dispatchMessage(
            {
              id: assistantMessageId,
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
              id: assistantMessageId,
              type: 'updateMessage',
              value: { reasoning: { content: accumulatedReasoning } },
            },
            dispatchContext,
          );
        }

        if (data.chunkType === 'tools_calling' && data.toolsCalling) {
          tools = data.toolsCalling.map(toToolPayload);
          updateAssistantTools();
          get().internal_toggleToolCallingStreaming(
            assistantMessageId,
            data.toolsCalling.map(() => true),
          );
        }
        break;
      }

      case 'stream_end': {
        get().internal_toggleToolCallingStreaming(assistantMessageId, undefined);
        break;
      }

      case 'tool_start': {
        const data = event.data as
          | {
              toolCalling?: Parameters<typeof toToolPayload>[0];
            }
          | undefined;
        if (!data?.toolCalling) break;

        const payload = toToolPayload(data.toolCalling);
        const toolMessageId = `mock-tool-msg-${assistantMessageId}-${payload.id}`;
        toolMessageIds.set(payload.id, toolMessageId);

        tools = tools.some((tool) => tool.id === payload.id)
          ? tools.map((tool) => (tool.id === payload.id ? { ...tool, ...payload } : tool))
          : [...tools, payload];
        updateAssistantTools();

        get().internal_dispatchMessage(
          {
            id: toolMessageId,
            type: 'createMessage',
            value: {
              agentId: context.agentId,
              content: '',
              parentId: assistantMessageId,
              plugin: payload,
              role: 'tool',
              sessionId: context.sessionId,
              threadId: context.threadId,
              tool_call_id: payload.id,
              topicId: context.topicId ?? undefined,
            },
          },
          dispatchContext,
        );
        break;
      }

      case 'tool_execute': {
        const data = event.data as ToolExecuteData | undefined;
        if (!data) break;

        const nextTools = tools.map((tool) =>
          tool.id === data.toolCallId
            ? { ...tool, intervention: { status: 'approved' as const } }
            : tool,
        );
        tools = nextTools;
        updateAssistantTools();
        break;
      }

      case 'tool_end': {
        const data = event.data as
          | {
              error?: unknown;
              isSuccess?: boolean;
              payload?: { state?: unknown };
              result?: unknown;
              toolCallId?: string;
            }
          | undefined;
        if (!data) break;

        const toolId = data.toolCallId ?? tools.at(-1)?.id;
        if (!toolId) break;

        const resultMessageId = toolMessageIds.get(toolId);
        const result = {
          content: stringifyResult(data.result ?? data.payload?.state),
          error: data.error,
          id: resultMessageId ?? toolId,
          state: data.result ?? data.payload?.state,
        };

        tools = tools.map((tool) =>
          tool.id === toolId ? { ...tool, result, result_msg_id: resultMessageId } : tool,
        );
        updateAssistantTools();

        if (resultMessageId) {
          get().internal_dispatchMessage(
            {
              id: resultMessageId,
              type: 'updateMessage',
              value: {
                content: result.content ?? '',
                error: data.isSuccess === false ? toChatMessageError(data.error) : undefined,
              },
            },
            dispatchContext,
          );
        }
        break;
      }

      case 'step_complete': {
        const data = event.data as StepCompleteData | undefined;
        if (data?.phase === 'execution_complete') {
          get().completeOperation(operationId);
        }
        break;
      }

      case 'agent_runtime_end': {
        get().internal_toggleToolCallingStreaming(assistantMessageId, undefined);
        get().completeOperation(operationId);
        break;
      }

      case 'error': {
        const messageError = toChatMessageError(event.data);
        get().internal_toggleToolCallingStreaming(assistantMessageId, undefined);
        get().failOperation(operationId, {
          message: messageError.message ?? 'Mock playback failed',
          type: String(messageError.type),
        });
        get().internal_dispatchMessage(
          {
            id: assistantMessageId,
            type: 'updateMessage',
            value: { error: messageError },
          },
          dispatchContext,
        );
        break;
      }
    }
  };
};
