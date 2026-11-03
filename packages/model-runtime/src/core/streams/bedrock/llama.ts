import type { InvokeModelWithResponseStreamResponse } from '@aws-sdk/client-bedrock-runtime';

import type { ChatStreamCallbacks } from '../../../types';
import { nanoid } from '../../../utils/uuid';
import type { StreamContext, StreamProtocolChunk } from '../protocol';
import { createCallbacksTransformer, createSSEProtocolTransformer } from '../protocol';
import { createBedrockStream } from './common';

interface AmazonBedrockInvocationMetrics {
  firstByteLatency: number;
  inputTokenCount: number;
  invocationLatency: number;
  outputTokenCount: number;
}
interface BedrockLlamaStreamChunk {
  'amazon-bedrock-invocationMetrics'?: AmazonBedrockInvocationMetrics;
  'generation': string;
  'generation_token_count': number;
  'prompt_token_count'?: number | null;
  'stop_reason'?: null | 'stop' | string;
}

export const transformLlamaStream = (
  chunk: BedrockLlamaStreamChunk,
  stack: StreamContext,
): StreamProtocolChunk => {
  // maybe need another structure to add support for multiple choices
  if (chunk.stop_reason) {
    return { data: 'finished', id: stack.id, type: 'stop' };
  }

  return { data: chunk.generation, id: stack.id, type: 'text' };
};

export const AWSBedrockLlamaStream = (
  res: InvokeModelWithResponseStreamResponse | ReadableStream,
  cb?: ChatStreamCallbacks,
): ReadableStream<Uint8Array> => {
  const streamStack: StreamContext = { id: 'chat_' + nanoid() };

  const stream = res instanceof ReadableStream ? res : createBedrockStream(res);

  return stream
    .pipeThrough(createSSEProtocolTransformer(transformLlamaStream, streamStack))
    .pipeThrough(createCallbacksTransformer(cb));
};
