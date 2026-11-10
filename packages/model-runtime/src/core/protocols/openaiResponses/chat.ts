import debug from 'debug';
import type OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

import type { ChatMethodOptions, ChatStreamPayload } from '../../../types';
import { debugPayload, debugResponse, debugStream } from '../../../utils/debugStream';
import { desensitizeUrl } from '../../../utils/desensitizeUrl';
import { getModelPricing } from '../../../utils/getModelPricing';
import { StreamingResponse } from '../../../utils/response';
import type { OpenAICompatibleRuntimeContext } from '../../openaiCompatibleFactory/context';
import type {
  OpenAICompatibleFactoryOptions,
  OpenAIExtraParams,
  ResponseCreateParamsWithPromptCacheKey,
} from '../../openaiCompatibleFactory/factoryOptions';
import {
  initializeOpenAIDiagnostics,
  observeOpenAIResponsesStream,
  recordOpenAIResponseMetadata,
  recordOpenAIResponsesResponse,
  resolveOpenAIResponseWithMetadata,
} from '../../openaiCompatibleFactory/providerDiagnostics';
import { resolveModelSamplingParameters } from '../../parameterResolver';
import { readableFromAsyncIterable } from '../../streams/protocol';
import type { OpenAIStreamOptions } from '../openaiChatCompletions/stream';
import { convertOpenAIResponseInputs } from './inputs';
import { transformResponseAPIToStream } from './nonStreamToStream';
import { OpenAIResponsesStream } from './stream';
import { convertChatCompletionToolToResponseTool, stripChatCompletionParameters } from './tools';

export const chatViaResponses = async (
  runtime: OpenAICompatibleRuntimeContext,
  factory: OpenAICompatibleFactoryOptions,
  payload: ChatStreamPayload,
  options?: ChatMethodOptions,
  usageModel = payload.model,
): Promise<Response> => {
  const log = debug(`${runtime.logPrefix}:handleResponseAPIMode`);
  log('handleResponseAPIMode called with model: %s', payload.model);

  const inputStartAt = Date.now();

  const {
    messages,
    reasoning_effort,
    tools,
    responsesTools,
    reasoning,
    responseMode,
    max_tokens,
    ...res
  } = factory.responses?.handlePayload
    ? (factory.responses.handlePayload(payload, runtime._options) as ChatStreamPayload)
    : payload;
  const requestModel =
    runtime.withMappedRequestModel({ model: res.model }, usageModel).model ?? usageModel;
  const reasoningSignatureScope = await runtime.getSignatureScope(
    requestModel,
    'reasoning',
    'responses',
  );

  const input = await convertOpenAIResponseInputs(messages as any, {
    forceImageBase64: factory.chatCompletion?.forceImageBase64,
    forceVideoBase64: factory.chatCompletion?.forceVideoBase64,
    provider: runtime.id,
    reasoningSignatureScope,
    strictToolPairing: true,
  });

  const isStreaming = payload.stream !== false;
  log(
    'isStreaming: %s, hasTools: %s, hasReasoning: %s',
    isStreaming,
    !!tools,
    !!(reasoning || reasoning_effort),
  );

  const postPayload = {
    ...stripChatCompletionParameters(res),
    ...(reasoning || reasoning_effort
      ? {
          reasoning: {
            ...reasoning,
            ...(reasoning_effort && { effort: reasoning_effort }),
          },
        }
      : {}),
    input,
    ...(max_tokens && { max_output_tokens: max_tokens }),
    store: false,
    stream: isStreaming || undefined,
    tools: responsesTools ?? tools?.map(convertChatCompletionToolToResponseTool),
    ...runtime.resolvePromptCacheKeyParams(
      res.model,
      options?.user,
      (res as OpenAIExtraParams).prompt_cache_key,
    ),
    // Responses API replaced `user` with `safety_identifier`; some endpoints reject `user`
    safety_identifier: options?.user,
    // Sanitize sampling params for Responses API path
    ...resolveModelSamplingParameters(res.model, res, {
      normalizeTemperature: false,
      preferTemperature: true,
    }),
  } as ResponseCreateParamsWithPromptCacheKey;
  const preparedRequest = runtime.prepareResponsesRequest(postPayload, usageModel);
  const requestPayload = preparedRequest.payload;
  const providerResponseDiagnostics = initializeOpenAIDiagnostics({
    apiMode: 'responses',
    diagnostics: options?.diagnostics,
    endpoint: desensitizeUrl(runtime.baseURL),
    payload: requestPayload,
    sentAt: Date.now(),
  });

  if (factory.debug?.responses?.()) {
    debugPayload(requestPayload);
  }

  log('sending responses.create request');

  const responsePromise = runtime.client.responses.create(requestPayload, {
    headers: {
      ...options?.requestHeaders,
      ...preparedRequest?.headers,
    },
    signal: options?.signal,
  });
  const responseWithMetadata = await resolveOpenAIResponseWithMetadata(responsePromise);
  const response = responseWithMetadata.data;
  recordOpenAIResponseMetadata(providerResponseDiagnostics, {
    requestId: responseWithMetadata.request_id,
    response: responseWithMetadata.response,
  });

  const streamOptions: OpenAIStreamOptions = {
    bizErrorTypeTransformer: factory.chatCompletion?.handleStreamBizErrorType,
    callbacks: options?.callback,
    payload: {
      apiMode: 'responses',
      model: usageModel,
      pricing: await getModelPricing(usageModel, runtime.id, options?.pricingContext),
      provider: runtime.id,
      reasoningSignatureScope,
    },
  };

  if (isStreaming) {
    log('processing streaming Responses API response');
    let prod = response as
      | ReadableStream<OpenAI.Responses.ResponseStreamEvent>
      | Stream<OpenAI.Responses.ResponseStreamEvent>;

    if (factory.debug?.responses?.()) {
      const [productionStream, useForDebug] = prod.tee();
      prod = productionStream;
      const useForDebugStream =
        useForDebug instanceof ReadableStream ? useForDebug : useForDebug.toReadableStream();

      debugStream(useForDebugStream).catch(console.error);
    }

    if (providerResponseDiagnostics) {
      /** Observe provider-native events before the Responses protocol adapter transforms them. */
      const observedStream = observeOpenAIResponsesStream(
        prod,
        providerResponseDiagnostics,
        options?.signal,
      );
      prod =
        observedStream instanceof ReadableStream
          ? observedStream
          : readableFromAsyncIterable(observedStream, {
              model: usageModel,
              provider: runtime.id,
            });
    }

    return StreamingResponse(OpenAIResponsesStream(prod, { ...streamOptions, inputStartAt }), {
      headers: options?.headers,
    });
  }

  log('processing non-streaming Responses API response');

  // Handle non-streaming response
  if (factory.debug?.responses?.()) {
    debugResponse(response);
  }

  await recordOpenAIResponsesResponse(
    providerResponseDiagnostics,
    response as OpenAI.Responses.Response,
    options?.signal,
  );

  if (responseMode === 'json') {
    log('returning JSON response mode');
    return Response.json(response);
  }

  log('transforming non-streaming Responses API response to stream');
  const stream = transformResponseAPIToStream(response as OpenAI.Responses.Response);

  return StreamingResponse(
    OpenAIResponsesStream(stream, { ...streamOptions, enableStreaming: false, inputStartAt }),
    {
      headers: options?.headers,
    },
  );
};
