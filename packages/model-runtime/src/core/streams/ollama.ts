import type { ChatResponse } from 'ollama/browser';

import type { ChatStreamCallbacks } from '../../types';
import { nanoid } from '../../utils/uuid';
import type { StreamProtocolChunk } from './protocol';
import type { StreamContext as StreamContextBase } from './protocol';

interface OllamaStreamContext extends StreamContextBase {
  contentBuffer?: string;
}
import {
  createCallbacksTransformer,
  createSSEProtocolTransformer,
  generateToolCallId,
} from './protocol';

const parseTextualToolCalls = (
  content: string,
): Array<{ name: string; args: Record<string, string> }> => {
  const calls: Array<{ name: string; args: Record<string, string> }> = [];

  const invokeRe = /<invoke\s+name\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/invoke\s*>/g;
  const paramRe = /<parameter\s+name\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/parameter\s*>/g;

  const extract = (body: string) => {
    let m: RegExpExecArray | null;
    invokeRe.lastIndex = 0;
    while ((m = invokeRe.exec(body)) !== null) {
      const name = m[1];
      const args: Record<string, string> = {};
      paramRe.lastIndex = 0;
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(m[2])) !== null) {
        args[pm[1]] = pm[2].trim();
      }
      calls.push({ name, args });
    }
  };

  // Try <tool_call>...<invoke>...</invoke>...</tool_call> blocks first
  const blockRe = /<([\w-]+:)?tool_call\s*>([\s\S]*?)<\/([\w-]+:)?tool_call\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(content)) !== null) {
    extract(m[2]);
  }

  // If no <tool_call> wrapper, try standalone <invoke> blocks
  if (calls.length === 0) extract(content);

  return calls;
};

const transformOllamaStream = (
  chunk: ChatResponse,
  stack: OllamaStreamContext,
): StreamProtocolChunk | StreamProtocolChunk[] => {
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
        index,
        type: 'function',
      })),
      id: stack.id,
      type: 'tool_calls',
    };
  }

  const content = chunk.message.content;

  if (content?.includes('<think>')) {
    stack.thinkingInContent = true;
  } else if (content?.includes('</think>')) {
    stack.thinkingInContent = false;
  }

  const cleaned = content?.replaceAll(/<\/?think>/g, '') ?? '';

  // Buffer content and detect XML-style tool calls (e.g. <tool_call><invoke name=...>)
  if (!stack.contentBuffer) stack.contentBuffer = '';

  // Check for complete <tool_call>...</tool_call> or <invoke>...</invoke> blocks
  const hasBlock = /<([\w-]+:)?tool_call\s*>[\s\S]*?<\/([\w-]+:)?tool_call\s*>/.test(
    stack.contentBuffer + cleaned,
  );
  const hasInvoke = /<invoke\s+name\s*=\s*"([^"]*)"\s*>[\s\S]*?<\/invoke\s*>/.test(
    stack.contentBuffer + cleaned,
  );

  if (hasBlock || hasInvoke) {
    stack.contentBuffer += cleaned;
    const buffer = stack.contentBuffer;
    const results: StreamProtocolChunk[] = [];

    const tagStart = buffer.search(/<(?:[\w-]+:)?tool_call\s*>|<invoke\s+name\s*=\s*"/);
    if (tagStart > 0) {
      results.push({
        data: buffer.slice(0, tagStart),
        id: stack.id,
        type: stack?.thinkingInContent ? 'reasoning' : 'text',
      });
    }

    for (const [i, call] of parseTextualToolCalls(buffer).entries()) {
      results.push({
        data: [
          {
            function: { arguments: JSON.stringify(call.args), name: call.name },
            id: generateToolCallId(i, call.name),
            index: i,
            type: 'function',
          },
        ],
        id: stack.id,
        type: 'tool_calls',
      });
    }

    // Keep trailing text after the last closing tag in buffer
    const closeRe = /<\/(?:[\w-]+:)?(?:tool_call|invoke)\s*>/g;
    let lastEnd = 0;
    let cm: RegExpExecArray | null;
    while ((cm = closeRe.exec(buffer)) !== null) {
      lastEnd = cm.index + cm[0].length;
    }
    stack.contentBuffer = lastEnd > 0 ? buffer.slice(lastEnd) : '';

    return results;
  }

  if (chunk.done) {
    const remaining = stack.contentBuffer + cleaned;
    stack.contentBuffer = '';
    const results: StreamProtocolChunk[] = [];
    if (remaining) {
      results.push({
        data: remaining,
        id: stack.id,
        type: stack?.thinkingInContent ? 'reasoning' : 'text',
      });
    }
    results.push({ data: 'finished', id: stack.id, type: 'stop' });
    return results;
  }

  // Only buffer when we see a tag that looks like the START of a tool call,
  // e.g. "<tool_call", "<minimax:tool_call", "<invoke name="
  // This avoids false positives like "<tool>" HTML tag
  const combined = stack.contentBuffer + cleaned;
  if (/<(?:[\w-]+:)?tool_call\b|<invoke\s+name\s*=\s*"/.test(combined)) {
    stack.contentBuffer = combined;
    return [];
  }

  // No tool call indicators — emit as text normally
  return {
    data: cleaned,
    id: stack.id,
    type: stack?.thinkingInContent ? 'reasoning' : 'text',
  };
};

export const OllamaStream = (
  res: ReadableStream<ChatResponse>,
  cb?: ChatStreamCallbacks,
): ReadableStream<Uint8Array> => {
  const streamStack: OllamaStreamContext = { id: 'chat_' + nanoid() };

  return res
    .pipeThrough(createSSEProtocolTransformer(transformOllamaStream, streamStack))
    .pipeThrough(createCallbacksTransformer(cb));
};
