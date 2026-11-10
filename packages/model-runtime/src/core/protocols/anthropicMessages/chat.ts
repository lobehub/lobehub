import type Anthropic from '@anthropic-ai/sdk';
import type { Stream } from '@anthropic-ai/sdk/streaming';
import debug from 'debug';

import { stripUnsupportedClaudeAssistantPrefill } from '../../../providers/anthropic/claudePrefill';
import { isAlwaysThinkingClaudeModel } from '../../../providers/anthropic/modelId';
import type { ChatMethodOptions, ChatStreamPayload } from '../../../types';
import { respondJsonAfterStream } from '../../../utils/consumeStream';
import { debugPayload, debugStream } from '../../../utils/debugStream';
import { desensitizeUrl } from '../../../utils/desensitizeUrl';
import { getModelPricing } from '../../../utils/getModelPricing';
import { StreamingResponse } from '../../../utils/response';
import type { AnthropicCompatibleFactoryOptions } from '../../anthropicCompatible';
import type { AnthropicCompatibleRuntimeContext } from '../../anthropicCompatible/context';
import { readableFromAsyncIterable } from '../../streams/protocol';
import {
  initializeAnthropicDiagnostics,
  observeAnthropicStream,
  recordAnthropicNonStreamingResponse,
  recordAnthropicResponseMetadata,
} from './diagnostics';
import { transformMessageToStream } from './nonStreamToStream';
import { AnthropicStream, type AnthropicStreamOptions } from './stream';

export const chatViaMessages = async (
  runtime: AnthropicCompatibleRuntimeContext,
  factory: AnthropicCompatibleFactoryOptions,
  payload: ChatStreamPayload,
  options?: ChatMethodOptions,
): Promise<Response> => {
  if (!factory.chatCompletion?.handlePayload) {
    throw new Error('Anthropic-compatible runtime requires chatCompletion.handlePayload');
  }

  const log = debug(`${runtime.logPrefix}:chat`);
  const inputStartAt = Date.now();

  log('chat called with model: %s, stream: %s', payload.model, payload.stream ?? true);

  const postPayload = await factory.chatCompletion.handlePayload(payload, runtime._options);
  const shouldStream = postPayload.stream ?? payload.stream ?? true;
  const finalPayload = { ...postPayload, stream: shouldStream };
  const requestPayload = runtime.withMappedRequestModel(finalPayload, payload.model);

  // Re-apply the prefill guard against the ACTUAL request model:
  // handlePayload stripped by the logical id, but a custom logical id the
  // parser doesn't recognize can map to a Claude 4.6+/5 request model
  // here. The strip is idempotent, so this is a no-op otherwise.
  if (requestPayload.model && Array.isArray(requestPayload.messages)) {
    requestPayload.messages = stripUnsupportedClaudeAssistantPrefill(
      requestPayload.model,
      requestPayload.messages,
    );
  }

  // Same for disabled thinking: handlePayload resolved it by the logical id, but the
  // mapped request model may be an always-thinking Claude that rejects `disabled` with a
  // 400. Omitting the config is the documented fallback (see resolveClaudeThinkingConfig).
  if (
    requestPayload.model &&
    (requestPayload as { thinking?: { type?: string } }).thinking?.type === 'disabled' &&
    isAlwaysThinkingClaudeModel(requestPayload.model)
  ) {
    delete (requestPayload as { thinking?: unknown }).thinking;
  }

  const shouldDebugChatCompletion = factory.debug?.chatCompletion?.() ?? false;
  if (shouldDebugChatCompletion) {
    debugPayload(requestPayload);
  }

  const providerRequestPayload = {
    ...requestPayload,
    metadata: options?.user ? { user_id: options.user } : undefined,
  };
  const providerRequestStartedAt = Date.now();
  const providerResponseDiagnostics = initializeAnthropicDiagnostics({
    diagnostics: options?.diagnostics,
    endpoint: desensitizeUrl(runtime.baseURL),
    payload: providerRequestPayload,
    sentAt: providerRequestStartedAt,
  });
  const responsePromise = runtime.client.messages.create(providerRequestPayload, {
    headers: options?.requestHeaders,
    signal: options?.signal,
  });
  /**
   * Custom Anthropic-compatible clients may return a plain Promise instead
   * of the SDK's APIPromise. Prefer withResponse() for request IDs and safe
   * headers, while preserving compatibility with those clients.
   */
  const responseWithMetadata =
    typeof responsePromise.withResponse === 'function'
      ? await responsePromise.withResponse()
      : { data: await responsePromise };
  const response = responseWithMetadata.data;
  recordAnthropicResponseMetadata(providerResponseDiagnostics, {
    requestId: 'request_id' in responseWithMetadata ? responseWithMetadata.request_id : undefined,
    response: 'response' in responseWithMetadata ? responseWithMetadata.response : undefined,
  });

  const pricing = await getModelPricing(payload.model, runtime.id, options?.pricingContext);
  const pricingOptions = await factory.chatCompletion?.getPricingOptions?.(payload, postPayload);
  const streamOptions = {
    callbacks: options?.callback,
    payload: {
      apiMode: 'messages',
      model: payload.model,
      pricing,
      pricingOptions,
      provider: runtime.id,
    },
  } satisfies Pick<AnthropicStreamOptions, 'callbacks' | 'payload'>;

  if (shouldStream) {
    const streamResponse = response as
      Stream<Anthropic.MessageStreamEvent> | ReadableStream<Anthropic.MessageStreamEvent>;
    let prod: Stream<Anthropic.MessageStreamEvent> | ReadableStream = streamResponse;

    if (shouldDebugChatCompletion) {
      const [productionStream, useForDebug] = streamResponse.tee();
      prod = productionStream;
      const useForDebugStream =
        useForDebug instanceof ReadableStream ? useForDebug : useForDebug.toReadableStream();

      debugStream(useForDebugStream).catch(console.error);
    }

    if (providerResponseDiagnostics) {
      /** Observe provider-native events before the protocol adapter transforms them. */
      const observedStream = observeAnthropicStream(
        prod,
        providerResponseDiagnostics,
        options?.signal,
      );
      prod =
        observedStream instanceof ReadableStream
          ? observedStream
          : readableFromAsyncIterable(observedStream, {
              model: payload.model,
              provider: runtime.id,
            });
    }

    return StreamingResponse(
      factory.chatCompletion?.handleStream
        ? factory.chatCompletion.handleStream(prod, {
            callbacks: streamOptions.callbacks,
            inputStartAt,
            payload,
          })
        : AnthropicStream(prod, { ...streamOptions, inputStartAt }),
      {
        headers: options?.headers,
      },
    );
  }

  await recordAnthropicNonStreamingResponse(
    providerResponseDiagnostics,
    response as Anthropic.Message,
    options?.signal,
  );

  const stream = transformMessageToStream(response as Anthropic.Message);

  const streamingResponse = StreamingResponse(
    factory.chatCompletion?.handleStream
      ? factory.chatCompletion.handleStream(stream, {
          callbacks: streamOptions.callbacks,
          inputStartAt,
          payload,
        })
      : AnthropicStream(stream, {
          ...streamOptions,
          enableStreaming: false,
          inputStartAt,
        }),
    {
      headers: options?.headers,
    },
  );

  if (payload.responseMode === 'json')
    return await respondJsonAfterStream(streamingResponse, response);
  return streamingResponse;
};
