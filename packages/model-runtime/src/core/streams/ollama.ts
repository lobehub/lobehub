import type { ChatResponse } from 'ollama/browser';

import type { ChatStreamCallbacks } from '../../types';
import { nanoid } from '../../utils/uuid';
import {
  createEventCallbacksTransformer,
  createModelEventTransformer,
  createSSEEncoder,
} from './events';
import type { StreamContext, StreamProtocolChunk } from './protocol';
import { generateToolCallId, getLeadingContent } from './protocol';

const transformOllamaStream = (
  chunk: ChatResponse,
  stack: StreamContext,
): StreamProtocolChunk | StreamProtocolChunk[] => {
  if (chunk.message.thinking) {
    // Native thinking is authoritative: it closes any open fallback block, and
    // a later literal <think> in the answer is text.
    stack.thinkingInContent = false;

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
        index,
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

  const content = chunk.message.content;

  // A <think> tag is structural only when it leads the answer. Models can quote
  // the same tag mid-answer (prompt-engineering examples, code samples);
  // flipping the state there would move the rest of the reply into reasoning or
  // strip the literal text.
  if (stack.thinkingInContent === undefined) {
    const leading = getLeadingContent(content);
    if (leading) stack.thinkingInContent = leading.startsWith('<think>');
  }

  if (stack.thinkingInContent) {
    if (content.includes('</think>')) {
      const [before, ...rest] = content.split('</think>');
      const after = rest.join('</think>');
      stack.thinkingInContent = false;

      const results: StreamProtocolChunk[] = [];
      const reasoning = before.replaceAll('<think>', '');
      if (reasoning) results.push({ data: reasoning, id: stack.id, type: 'reasoning' });
      if (after) results.push({ data: after, id: stack.id, type: 'text' });

      return results.length > 0 ? results : { data: '', id: stack.id, type: 'text' };
    }

    // Remove think tags only inside the fallback thinking block; in text mode
    // they are literal answer content.
    return { data: content.replaceAll(/<\/?think>/g, ''), id: stack.id, type: 'reasoning' };
  }

  return { data: content, id: stack.id, type: 'text' };
};

export const OllamaStream = (
  res: ReadableStream<ChatResponse>,
  cb?: ChatStreamCallbacks,
): ReadableStream<Uint8Array> => {
  const streamStack: StreamContext = { id: 'chat_' + nanoid() };

  return res
    .pipeThrough(createModelEventTransformer(transformOllamaStream, streamStack))
    .pipeThrough(createEventCallbacksTransformer(cb))
    .pipeThrough(createSSEEncoder());
};
