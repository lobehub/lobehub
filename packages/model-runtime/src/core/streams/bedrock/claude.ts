import { InvokeModelWithResponseStreamResponse } from '@aws-sdk/client-bedrock-runtime';

import { ChatStreamCallbacks } from '../../../types';
import { nanoid } from '../../../utils/uuid';
import { transformAnthropicStream } from '../anthropic';
import {
  StreamContext,
  createCallbacksTransformer,
  createSSEProtocolTransformer,
  createTokenSpeedCalculator,
} from '../protocol';
import { createBedrockStream } from './common';

export const AWSBedrockClaudeStream = (
  res: InvokeModelWithResponseStreamResponse | ReadableStream,
  options?: {
    callbacks?: ChatStreamCallbacks;
    inputStartAt?: number;
    payload?: Parameters<typeof transformAnthropicStream>[2];
  },
): ReadableStream<Uint8Array> => {
  const streamStack: StreamContext = { id: 'chat_' + nanoid() };

  const stream = res instanceof ReadableStream ? res : createBedrockStream(res);

  const transformWithPayload: typeof transformAnthropicStream = (chunk, ctx) =>
    transformAnthropicStream(chunk, ctx, options?.payload);

  return stream
    .pipeThrough(
      createTokenSpeedCalculator(transformWithPayload, {
        inputStartAt: options?.inputStartAt,
        streamStack,
      }),
    )
    .pipeThrough(createSSEProtocolTransformer((c) => c, streamStack))
    .pipeThrough(createCallbacksTransformer(options?.callbacks));
};
