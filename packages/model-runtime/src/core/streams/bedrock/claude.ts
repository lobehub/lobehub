import type { InvokeModelWithResponseStreamResponse } from '@aws-sdk/client-bedrock-runtime';

import type { ChatStreamCallbacks } from '../../../types';
import { nanoid } from '../../../utils/uuid';
import { transformAnthropicStream } from '../anthropic';
import {
  createEventCallbacksTransformer,
  createModelEventTransformer,
  createSSEEncoder,
} from '../events';
import type { StreamContext } from '../protocol';
import { createTokenSpeedCalculator } from '../protocol';
import { createBedrockStream } from './common';

export const AWSBedrockClaudeStream = (
  res: InvokeModelWithResponseStreamResponse | ReadableStream,
  options?: {
    callbacks?: ChatStreamCallbacks;
    inputStartAt?: number;
    payload?: Parameters<typeof transformAnthropicStream>[2];
  },
): ReadableStream<Uint8Array> => {
  const streamStack: StreamContext = {
    id: 'chat_' + nanoid(),
    pricingOptions: options?.payload?.pricingOptions,
  };

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
    .pipeThrough(
      // Same Messages event contract as `AnthropicStream`: closing without a terminal event is a truncation.
      createModelEventTransformer((c) => c, streamStack, { requireTerminalEvent: true }),
    )
    .pipeThrough(createEventCallbacksTransformer(options?.callbacks, { streamStack }))
    .pipeThrough(createSSEEncoder());
};
