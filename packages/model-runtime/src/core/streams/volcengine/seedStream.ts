import type OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

import type { ChatStreamCallbacks } from '../../../types';
import { transformOpenAIStream } from '../openai/openai';
import type {
  ChatPayloadForTransformStream,
  StreamContext,
  StreamProtocolChunk,
} from '../protocol';
import {
  convertIterableToStream,
  createCallbacksTransformer,
  createSSEProtocolTransformer,
  createTokenSpeedCalculator,
} from '../protocol';
import {
  extractSeedToolCallsFromText,
  flushSeedToolCallBuffer,
  isDoubaoSeedModel,
} from './parseSeedToolCall';

const applySeedToolCallExtraction = (
  chunk: StreamProtocolChunk,
  streamContext: StreamContext,
): StreamProtocolChunk | StreamProtocolChunk[] => {
  if (chunk.type === 'tool_calls') return chunk;
  if (chunk.type !== 'text' || typeof chunk.data !== 'string') return chunk;

  const { chunks, remainingBuffer } = extractSeedToolCallsFromText(
    chunk.data,
    streamContext.seedToolCallBuffer ?? '',
  );
  streamContext.seedToolCallBuffer = remainingBuffer;

  if (chunks.length === 0) {
    return { ...chunk, data: '' };
  }

  if (chunks.length === 1) {
    return { ...chunks[0], id: chunk.id ?? chunks[0].id };
  }

  return chunks.map((item) => ({ ...item, id: chunk.id ?? item.id }));
};

const normalizeSeedStreamChunks = (
  result: StreamProtocolChunk | StreamProtocolChunk[],
  streamContext: StreamContext,
): StreamProtocolChunk | StreamProtocolChunk[] => {
  if (Array.isArray(result)) {
    return result.flatMap((chunk) => {
      const processed = applySeedToolCallExtraction(chunk, streamContext);
      return Array.isArray(processed) ? processed : [processed];
    });
  }

  return applySeedToolCallExtraction(result, streamContext);
};

export const transformVolcengineSeedStream = (
  chunk: OpenAI.ChatCompletionChunk,
  streamContext: StreamContext,
  payload?: ChatPayloadForTransformStream,
): StreamProtocolChunk | StreamProtocolChunk[] => {
  const base = transformOpenAIStream(chunk, streamContext, payload);

  if (!isDoubaoSeedModel(payload?.model) || !payload?.tools?.length) {
    return base;
  }

  const item = chunk.choices?.[0];

  if (item?.finish_reason) {
    const flushed = flushSeedToolCallBuffer(streamContext.seedToolCallBuffer ?? '');
    streamContext.seedToolCallBuffer = '';

    if (flushed.length === 0) {
      return normalizeSeedStreamChunks(base, streamContext);
    }

    const processedBase = normalizeSeedStreamChunks(base, streamContext);
    const baseChunks = Array.isArray(processedBase) ? processedBase : [processedBase];

    return [...baseChunks, ...flushed.map((c) => ({ ...c, id: chunk.id ?? c.id }))];
  }

  return normalizeSeedStreamChunks(base, streamContext);
};

export const VolcengineSeedAIStream = (
  stream: Stream<OpenAI.ChatCompletionChunk> | ReadableStream,
  {
    callbacks,
    payload,
    inputStartAt,
    enableStreaming = true,
  }: {
    callbacks?: ChatStreamCallbacks;
    enableStreaming?: boolean;
    inputStartAt?: number;
    payload?: ChatPayloadForTransformStream;
  } = {},
) => {
  const streamContext: StreamContext = { id: '' };
  const readableStream =
    stream instanceof ReadableStream ? stream : convertIterableToStream(stream);

  const transformWithPayload = (chunk: OpenAI.ChatCompletionChunk, context: StreamContext) =>
    transformVolcengineSeedStream(chunk, context, payload);

  return readableStream
    .pipeThrough(
      createTokenSpeedCalculator(transformWithPayload, {
        enableStreaming,
        inputStartAt,
        streamStack: streamContext,
      }),
    )
    .pipeThrough(createSSEProtocolTransformer((c) => c, streamContext))
    .pipeThrough(createCallbacksTransformer(callbacks, { streamStack: streamContext }));
};
