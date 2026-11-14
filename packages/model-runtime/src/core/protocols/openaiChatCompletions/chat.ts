import type debug from 'debug';
import type OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

import type { ChatMethodOptions, ChatStreamPayload } from '../../../types';
import { respondJsonAfterStream } from '../../../utils/consumeStream';
import { debugPayload, debugResponse, debugStream } from '../../../utils/debugStream';
import { desensitizeUrl } from '../../../utils/desensitizeUrl';
import { getModelPricing } from '../../../utils/getModelPricing';
import { StreamingResponse } from '../../../utils/response';
import type { OpenAICompatibleRuntimeContext } from '../../openaiCompatible/context';
import type { OpenAICompatibleFactoryOptions } from '../../openaiCompatible/factoryOptions';
import {
  initializeOpenAIDiagnostics,
  observeOpenAIChatCompletionStream,
  recordOpenAIChatCompletionResponse,
  recordOpenAIResponseMetadata,
  resolveOpenAIResponseWithMetadata,
} from '../../openaiCompatible/providerDiagnostics';
import { resolveModelSamplingParameters } from '../../parameterResolver';
import { readableFromAsyncIterable } from '../../streams/protocol';
import { convertOpenAIMessages } from './messages';
import { transformResponseToStream } from './nonStreamToStream';
import type { OpenAIStreamOptions } from './stream';
import { OpenAIStream } from './stream';

export interface ChatCompletionsRequest {
  handledPayload: OpenAI.ChatCompletionCreateParamsStreaming;
  inputStartAt: number;
  log: debug.Debugger;
  options?: ChatMethodOptions;
  payload: Omit<ChatStreamPayload, 'responseMode'>;
  /** The payload before `chatCompletion.handlePayload`, used by custom stream clients. */
  processedPayload: any;
  responseMode?: ChatStreamPayload['responseMode'];
}

export const chatViaChatCompletions = async (
  runtime: OpenAICompatibleRuntimeContext,
  factory: OpenAICompatibleFactoryOptions,
  {
    handledPayload,
    inputStartAt,
    log,
    options,
    payload,
    processedPayload,
    responseMode,
  }: ChatCompletionsRequest,
): Promise<Response> => {
  // Sanitize temperature/top_p conflict for Claude 4+ models routed via OpenAI-compatible API.
  // normalizeTemperature is false here because OpenAI-compatible providers use the raw range.
  const postPayload = {
    ...handledPayload,
    ...resolveModelSamplingParameters(handledPayload.model, handledPayload, {
      normalizeTemperature: false,
      preferTemperature: true,
    }),
  };

  const requestModel =
    runtime.withMappedRequestModel({ model: postPayload.model }, payload.model).model ??
    payload.model;
  const thoughtSignatureScope = await runtime.getSignatureScope(
    requestModel,
    'thought_signature',
    'chat_completions',
  );
  const messages = await convertOpenAIMessages(postPayload.messages, {
    forceImageBase64: factory.chatCompletion?.forceImageBase64,
    forceVideoBase64: factory.chatCompletion?.forceVideoBase64,
    model: postPayload.model,
    supportsAudioInput: factory.chatCompletion?.supportsAudioInput,
    thoughtSignatureScope,
  });
  const includeUsageRequested = Boolean(
    postPayload.stream && !factory.chatCompletion?.excludeUsage,
  );

  let response:
    | OpenAI.ChatCompletion
    | ReadableStream<OpenAI.Chat.Completions.ChatCompletionChunk>
    | Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
  let providerResponseDiagnostics;

  const streamOptions: OpenAIStreamOptions = {
    bizErrorTypeTransformer: factory.chatCompletion?.handleStreamBizErrorType,
    callbacks: options?.callback,
    payload: {
      apiMode: 'chat_completions',
      includeUsageRequested,
      model: payload.model,
      pricing: await getModelPricing(payload.model, runtime.id, options?.pricingContext),
      provider: runtime.id,
      thoughtSignatureScope,
    },
  };

  if (factory.customClient?.createChatCompletionStream) {
    log('using custom client for chat completion stream');
    // Apply sampling sanitization to processedPayload for the custom client path.
    // We use processedPayload (ChatStreamPayload type) here because
    // createChatCompletionStream expects ChatStreamPayload, not the OpenAI SDK format.
    // Strip LobeHub-internal fields that should never reach downstream APIs.
    const {
      apiMode: _apiMode,
      preserveThinking: _preserveThinking,
      ...cleanProcessedPayload
    } = processedPayload as any;
    const customRequestPayload = {
      ...cleanProcessedPayload,
      ...resolveModelSamplingParameters(cleanProcessedPayload.model, cleanProcessedPayload, {
        normalizeTemperature: false,
        preferTemperature: true,
      }),
    };
    const requestPayload = runtime.withMappedRequestModel(customRequestPayload, payload.model);
    providerResponseDiagnostics = initializeOpenAIDiagnostics({
      apiMode: 'chat_completions',
      diagnostics: options?.diagnostics,
      endpoint: desensitizeUrl(runtime.baseURL),
      payload: requestPayload,
      sentAt: Date.now(),
    });

    response = factory.customClient.createChatCompletionStream(
      runtime.client,
      requestPayload,
      runtime.instance,
    ) as any;
    recordOpenAIResponseMetadata(providerResponseDiagnostics, {});
  } else {
    // Remove LobeHub-internal fields before sending to downstream API.
    // `preserveThinking` is only consumed by Qwen/Zhipu handlePayload (which runs above)
    // and must not leak to other providers' APIs as an unknown parameter.
    const { apiMode: _, preserveThinking: _pt, ...cleanedPayload } = postPayload as any;
    const finalPayload = {
      ...cleanedPayload,
      messages,
      ...(factory.chatCompletion?.noUserId ? {} : { user: options?.user }),
      ...runtime.resolvePromptCacheKeyParams(
        cleanedPayload.model,
        options?.user,
        cleanedPayload.prompt_cache_key,
      ),
      stream_options: includeUsageRequested ? { include_usage: true } : undefined,
    };
    const requestPayload = runtime.withMappedRequestModel(finalPayload, payload.model);

    log('sending chat completion request with %d messages', messages.length);

    if (factory.debug?.chatCompletion?.()) {
      debugPayload(requestPayload);
    }

    providerResponseDiagnostics = initializeOpenAIDiagnostics({
      apiMode: 'chat_completions',
      diagnostics: options?.diagnostics,
      endpoint: desensitizeUrl(runtime.baseURL),
      payload: requestPayload,
      sentAt: Date.now(),
    });
    const responsePromise = runtime.client.chat.completions.create(requestPayload, {
      // https://github.com/lobehub/lobe-chat/pull/318
      headers: { Accept: '*/*', ...options?.requestHeaders },
      signal: options?.signal,
    });
    const responseWithMetadata = await resolveOpenAIResponseWithMetadata(responsePromise);
    response = responseWithMetadata.data as
      OpenAI.ChatCompletion | Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
    recordOpenAIResponseMetadata(providerResponseDiagnostics, {
      requestId: responseWithMetadata.request_id,
      response: responseWithMetadata.response,
    });
  }

  if (postPayload.stream) {
    log('processing streaming response');
    let prod = response as
      | ReadableStream<OpenAI.Chat.Completions.ChatCompletionChunk>
      | Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;

    if (factory.debug?.chatCompletion?.()) {
      const [productionStream, useForDebug] = prod.tee();
      prod = productionStream;
      const useForDebugStream =
        useForDebug instanceof ReadableStream ? useForDebug : useForDebug.toReadableStream();

      debugStream(useForDebugStream).catch(console.error);
    }

    if (providerResponseDiagnostics) {
      /** Observe provider-native chunks before the OpenAI protocol adapter transforms them. */
      const observedStream = observeOpenAIChatCompletionStream(
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
            payload: streamOptions.payload,
          })
        : OpenAIStream(prod, {
            ...streamOptions,
            inputStartAt,
          }),
      {
        headers: options?.headers,
      },
    );
  }

  if (factory.debug?.chatCompletion?.()) {
    debugResponse(response);
  }

  await recordOpenAIChatCompletionResponse(
    providerResponseDiagnostics,
    response as OpenAI.ChatCompletion,
    options?.signal,
  );

  log('transforming non-streaming response to stream');
  // Snapshot first: provider transform handlers may rewrite the completion in place
  const jsonBody = responseMode === 'json' ? structuredClone(response) : undefined;
  const transformHandler =
    factory.chatCompletion?.handleTransformResponseToStream || transformResponseToStream;
  const stream = transformHandler(response as unknown as OpenAI.ChatCompletion);

  const streamingResponse = StreamingResponse(
    factory.chatCompletion?.handleStream
      ? factory.chatCompletion.handleStream(stream, {
          callbacks: streamOptions.callbacks,
          inputStartAt,
          payload: streamOptions.payload,
        })
      : OpenAIStream(stream, { ...streamOptions, enableStreaming: false, inputStartAt }),
    {
      headers: options?.headers,
    },
  );
  if (jsonBody) return await respondJsonAfterStream(streamingResponse, jsonBody);
  return streamingResponse;
};
