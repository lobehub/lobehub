import type { ChatResponse } from 'ollama/browser';

import type { ChatStreamCallbacks } from '../../types';
import { nanoid } from '../../utils/uuid';
import type { StreamContext, StreamProtocolChunk } from './protocol';
import {
  createCallbacksTransformer,
  createSSEProtocolTransformer,
  generateToolCallId,
} from './protocol';

const transformOllamaStream = (chunk: ChatResponse, stack: StreamContext): StreamProtocolChunk => {
  if (chunk.message.thinking) {
    return { data: chunk.message.thinking, id: stack.id, type: 'reasoning' };
  }

  if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
    return {
      data: chunk.message.tool_calls.map((value, index) => ({
        function: {
          arguments: JSON.stringify(value.function?.arguments) ?? '{}',
          name: value.function?.name ?? null,
        },
        id: generateToolCallId(index, value.function?.name),
        index: index,
        type: 'function',
      })),
      id: stack.id,
      type: 'tool_calls',
    };
  }

  // maybe need another structure to add support for multiple choices
  if (chunk.done && !chunk.message.content) {
    return { data: 'finished', id: stack.id, type: 'stop' };
  }

  // Check for <think> or </think> tags and update thinkingInContent state
  if (chunk.message.content.includes('<think>')) {
    stack.thinkingInContent = true;
  } else if (chunk.message.content.includes('</think>')) {
    stack.thinkingInContent = false;
  }

  // Remove <think> and </think> tags, and determine return type based on current thinking mode
  return {
    data: chunk.message.content.replaceAll(/<\/?think>/g, ''),
    id: stack.id,
    type: stack?.thinkingInContent ? 'reasoning' : 'text',
  };
};

export const OllamaStream = (
  res: ReadableStream<ChatResponse>,
  cb?: ChatStreamCallbacks,
): ReadableStream<Uint8Array> => {
  const streamStack: StreamContext = { id: 'chat_' + nanoid() };

  return res
    .pipeThrough(createSSEProtocolTransformer(transformOllamaStream, streamStack))
    .pipeThrough(createCallbacksTransformer(cb));
};
