import type OpenAI from 'openai';
import type {
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
} from 'openai/resources/index.mjs';
import type { Stream } from 'openai/streaming';

import type { ChatStreamCallbacks } from '../../types';
import { convertOpenAIUsage } from '../usageConverters';
import type {
  StreamContext,
  StreamProtocolChunk,
  StreamProtocolToolCallChunk,
  StreamToolCallChunkData,
} from './protocol';
import {
  convertIterableToStream,
  createCallbacksTransformer,
  createSSEProtocolTransformer,
  createTokenSpeedCalculator,
  generateToolCallId,
} from './protocol';

export const transformQwenStream = (
  chunk: OpenAI.ChatCompletionChunk,
  streamContext?: StreamContext,
): StreamProtocolChunk | StreamProtocolChunk[] => {
  if (Array.isArray(chunk.choices) && chunk.choices.length === 0 && chunk.usage) {
    const usage = convertOpenAIUsage({
      ...chunk.usage,
      completion_tokens_details: chunk.usage.completion_tokens_details || {},
      prompt_tokens_details: chunk.usage.prompt_tokens_details || {},
    });

    if (streamContext) {
      streamContext.usage = usage;
    }

    return { data: usage, id: chunk.id, type: 'usage' };
  }

  const item = chunk.choices[0];

  if (!item) {
    return { data: chunk, id: chunk.id, type: 'data' };
  }

  if (Array.isArray(item.delta?.content)) {
    const part = item.delta.content[0];
    const process = (part: ChatCompletionContentPart): ChatCompletionContentPartText => {
      const [key, value] = Object.entries(part)[0];
      if (key === 'image') {
        return {
          text: `![image](${value})`,
          type: 'text',
        };
      }
      return {
        text: value,
        type: 'text',
      };
    };

    const data = process(part);

    return {
      data: data.text,
      id: chunk.id,
      type: 'text',
    };
  }

  if (item.delta?.tool_calls) {
    return {
      data: item.delta.tool_calls.map((value, arrayIndex): StreamToolCallChunkData => {
        // Get the actual tool index from the chunk, fallback to array position
        const toolIndex = typeof value.index !== 'undefined' ? value.index : arrayIndex;

        // Store tool call info in streamContext.tools map by index for parallel tool calls
        // This allows us to correctly track multiple tools being called in parallel
        if (streamContext && value.id && value.function?.name) {
          if (!streamContext.tools) {
            streamContext.tools = {};
          }
          streamContext.tools[toolIndex] = {
            id: value.id,
            index: toolIndex,
            name: value.function.name,
          };
        }

        // Get stored tool info for this index (for incremental chunks without id)
        const storedTool = streamContext?.tools?.[toolIndex];

        return {
          // Qwen models may send tool_calls in two separate chunks:
          // 1. First chunk: {id, name} without arguments
          // 2. Second chunk: {id, arguments} without name
          // We need to provide default values to handle both cases
          // Use null for missing name (same as OpenAI stream behavior)
          function: {
            arguments: value.function?.arguments ?? '',
            name: value.function?.name ?? null,
          },
          // For incremental chunks without id, use the stored tool id from streamContext.tools
          // based on the tool index to correctly associate arguments with the right tool call
          id: value.id || storedTool?.id || generateToolCallId(toolIndex, value.function?.name),
          index: toolIndex,
          type: value.type || 'function',
        };
      }),
      id: chunk.id,
      type: 'tool_calls',
    } as StreamProtocolToolCallChunk;
  }

  // DeepSeek reasoner will put thinking in the reasoning_content field
  if (
    item.delta &&
    'reasoning_content' in item.delta &&
    typeof item.delta.reasoning_content === 'string' &&
    item.delta.reasoning_content !== ''
  ) {
    return { data: item.delta.reasoning_content, id: chunk.id, type: 'reasoning' };
  }

  if (typeof item.delta?.content === 'string') {
    return { data: item.delta.content, id: chunk.id, type: 'text' };
  }

  if (item.finish_reason) {
    return { data: item.finish_reason, id: chunk.id, type: 'stop' };
  }

  if (item.delta?.content === null) {
    return { data: item.delta, id: chunk.id, type: 'data' };
  }

  return {
    data: { delta: item.delta, id: chunk.id, index: item.index },
    id: chunk.id,
    type: 'data',
  };
};

export const QwenAIStream = (
  stream: Stream<OpenAI.ChatCompletionChunk> | ReadableStream,
  // TODO: preserve for RFC 097

  {
    callbacks,
    inputStartAt,
    enableStreaming = true,
  }: { callbacks?: ChatStreamCallbacks; enableStreaming?: boolean; inputStartAt?: number } = {},
) => {
  const streamContext: StreamContext = { id: '' };
  const readableStream =
    stream instanceof ReadableStream ? stream : convertIterableToStream(stream);

  return readableStream
    .pipeThrough(
      createTokenSpeedCalculator(transformQwenStream, {
        enableStreaming: enableStreaming,
        inputStartAt,
        streamStack: streamContext,
      }),
    )
    .pipeThrough(createSSEProtocolTransformer((c) => c, streamContext))
    .pipeThrough(createCallbacksTransformer(callbacks));
};
