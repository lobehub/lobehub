import type { ChatModelCard } from '@lobechat/types';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import debug from 'debug';
import type { AiFullModelCard, AiModelType } from 'model-bank';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import type { ClientOptions } from 'openai';
import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

import { ErrorClassifier } from '../../errors';
import {
  isGPT5ProResponsesModel,
  isResponsesAPIModel,
  supportsGPT5ResponsesReasoningEffortNone,
} from '../../providers/openai/openaiModelId';
import type {
  ASROptions,
  ASRPayload,
  ASRResponse,
  ChatCompletionErrorPayload,
  ChatCompletionTool,
  ChatMethodOptions,
  ChatStreamCallbacks,
  ChatStreamPayload,
  Embeddings,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  TextToSpeechOptions,
  TextToSpeechPayload,
} from '../../types';
import type { ILobeAgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeErrorType } from '../../types/error';
import type {
  CreateImageMethodOptions,
  CreateImagePayload,
  CreateImageResponse,
} from '../../types/image';
import type {
  CreateVideoPayload,
  CreateVideoResponse,
  HandleCreateVideoWebhookPayload,
  HandleCreateVideoWebhookResult,
  PollVideoStatusResult,
} from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';
import { debugResponse, debugStream } from '../../utils/debugStream';
import { desensitizeUrl } from '../../utils/desensitizeUrl';
import { getModelPropertyWithFallback } from '../../utils/getFallbackModelProperty';
import { getModelPricing } from '../../utils/getModelPricing';
import { handleOpenAIError } from '../../utils/handleOpenAIError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { resolveMappedModelId, withMappedModelId } from '../../utils/modelIdMapping';
import { detectModelProvider } from '../../utils/modelParse';
import { postProcessModelList } from '../../utils/postProcessModelList';
import {
  assertContextWithinWindow,
  type AssertContextWithinWindowOptions,
  ContextExceededPreFlightError,
} from '../../utils/resolveSafeMaxTokens';
import { StreamingResponse } from '../../utils/response';
import type { LobeRuntimeAI } from '../BaseAI';
import { normalizeToolsParameters } from '../contextBuilders/normalizeToolSchema';
import { convertOpenAIMessages, convertOpenAIResponseInputs } from '../contextBuilders/openai';
import { resolveModelSamplingParameters } from '../parameterResolver';
import type { OpenAIStreamOptions } from '../streams';
import { OpenAIResponsesStream, OpenAIStream } from '../streams';
import type { ChatPayloadForTransformStream } from '../streams/protocol';
import { convertOpenAIResponseUsage, convertOpenAIUsage } from '../usageConverters/openai';
import { createOpenAICompatibleImage } from './createImage';
import { createOpenAICompatibleVideo, pollOpenAICompatibleVideoStatus } from './createVideo';
import { transformResponseAPIToStream, transformResponseToStream } from './nonStreamToStream';

export type { PollVideoStatusResult };
export * from './createVideo';
export * from './nonStreamToStream';

/**
 * Detect provider 400/422 errors that reject `response_format: { type: 'json_schema' }`.
 * Known message variants from the DeepSeek family (official API and gateways proxying it):
 * - `This response_format type is unavailable now`
 * - `response_format.type \`json_schema\` is unavailable now`
 */
export const isResponseFormatUnsupportedError = (error: unknown): boolean => {
  const err = error as { error?: { message?: unknown }; message?: unknown };
  const message = [err?.message, err?.error?.message]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  if (!message) return false;

  return /(?:response_format|json_schema)[^]*?(?:unavailable|not +support)/i.test(message);
};

// the model contains the following keywords is not a chat model, so we should filter them out
export const CHAT_MODELS_BLOCK_LIST = [
  'embedding',
  'davinci',
  'curie',
  'moderation',
  'ada',
  'babbage',
  'tts',
  'whisper',
  'dall-e',
];

// OpenAI SDK v6 widened `apiKey` to `string | ApiKeySetter`; lobehub only ever
// passes a plain string, so narrow it back to keep `.trim()` / string assignments valid.
type LobeClientOptions = Omit<ClientOptions, 'apiKey'> & { apiKey?: string };
type ConstructorOptions<T extends Record<string, any> = any> = LobeClientOptions &
  ModelIdMappingOptions &
  T;
type OpenAIExtraParams = { prompt_cache_key?: string; safety_identifier?: string };
type ChatCompletionCreateParamsWithPromptCacheKey = Omit<
  OpenAI.ChatCompletionCreateParamsNonStreaming,
  'reasoning_effort'
> &
  Pick<OpenAIExtraParams, 'prompt_cache_key'> &
  Pick<GenerateObjectPayload, 'reasoning_effort'>;
type GenerateObjectReasoningParams = Pick<GenerateObjectPayload, 'reasoning_effort' | 'thinking'>;
type ResponseCreateParamsWithPromptCacheKey = (
  | OpenAI.Responses.ResponseCreateParamsStreaming
  | OpenAI.Responses.ResponseCreateParams
) &
  OpenAIExtraParams;
// Exclude openai's own `provider` (added in openai SDK 6.45.0 as `provider?: Provider`
// for its third-party-provider feature) — otherwise intersecting it with our
// `provider: string` collapses to `Provider & string`, breaking every call site
// that passes a plain provider id string.
export type CreateImageOptions = Omit<ClientOptions, 'apiKey' | 'provider'> &
  ModelIdMappingOptions & {
    apiKey: string;
    provider: string;
  };

const getGenerateObjectReasoningParams = ({
  reasoning_effort,
  thinking,
}: GenerateObjectReasoningParams) => ({
  // `thinking` is a Lobe runtime abstraction, not a generic OpenAI-compatible API field.
  // Use it here only to suppress `reasoning_effort`; providers that support thinking
  // must translate it via `generateObject.handlePayload`.
  ...(reasoning_effort && thinking?.type !== 'disabled' ? { reasoning_effort } : {}),
});

const getGenerateObjectResponsesReasoningParams = ({
  model,
  reasoning_effort,
  thinking,
}: GenerateObjectReasoningParams & { model: string }) => {
  if (isGPT5ProResponsesModel(model)) {
    return reasoning_effort && reasoning_effort !== 'max' ? { reasoning: { effort: 'high' } } : {};
  }

  if (thinking?.type === 'disabled') {
    return supportsGPT5ResponsesReasoningEffortNone(model) ? { reasoning: { effort: 'none' } } : {};
  }

  return reasoning_effort && reasoning_effort !== 'max'
    ? { reasoning: { effort: reasoning_effort } }
    : {};
};

// See CreateImageOptions above: drop openai's `provider` so ours stays `string`.
export type CreateVideoOptions = Omit<ClientOptions, 'apiKey' | 'provider'> &
  ModelIdMappingOptions & {
    apiKey: string;
    provider: string;
  };

export interface CustomClientOptions<T extends Record<string, any> = any> {
  createChatCompletionStream?: (
    client: any,
    payload: ChatStreamPayload,
    instance: any,
  ) => ReadableStream<any>;
  createClient?: (options: ConstructorOptions<T>) => any;
}

export interface OpenAICompatibleFactoryOptions<T extends Record<string, any> = any> {
  apiKey?: string;
  baseURL?: string;
  chatCompletion?: {
    /**
     * When set, the factory runs a pre-flight token estimate against the
     * provided model list before dispatching to upstream. If the estimated
     * prompt tokens strictly exceed the model's context window, the
     * request is aborted with a structured `ExceededContextWindow` error
     * — see .
     *
     * This is for providers like NVIDIA / DeepSeek where the harness does
     * not cap `max_tokens` itself but we still want to fail fast on doomed
     * requests instead of round-tripping to the upstream just to get a
     * 400 back. Providers that manage `max_tokens` themselves (e.g.
     * MiniMax via `resolveSafeMaxTokens`) still benefit because the
     * factory's centralised error handler converts the same error class.
     */
    contextPreFlight?: AssertContextWithinWindowOptions & {
      models: AiFullModelCard[];
    };
    excludeUsage?: boolean;
    forceImageBase64?: boolean;
    forceVideoBase64?: boolean;
    handleError?: (
      error: any,
      options: ConstructorOptions<T>,
    ) => Omit<ChatCompletionErrorPayload, 'provider'> | undefined;
    handlePayload?: (
      payload: ChatStreamPayload,
      options: ConstructorOptions<T>,
    ) => OpenAI.ChatCompletionCreateParamsStreaming;
    handleStream?: (
      stream: Stream<OpenAI.ChatCompletionChunk> | ReadableStream,
      options: {
        callbacks?: ChatStreamCallbacks;
        inputStartAt?: number;
        payload?: ChatPayloadForTransformStream;
      },
    ) => ReadableStream;
    handleStreamBizErrorType?: (error: {
      message: string;
      name: string;
    }) => ILobeAgentRuntimeErrorType | undefined;
    handleTransformResponseToStream?: (
      data: OpenAI.ChatCompletion,
    ) => ReadableStream<OpenAI.ChatCompletionChunk>;
    noUserId?: boolean;
    /**
     * If true, route chat requests to Responses API path directly
     */
    useResponse?: boolean;
    /**
     * Allow only some models to use Responses API by simple matching.
     * If any string appears in model id or RegExp matches, Responses API is used.
     */
    useResponseModels?: Array<string | RegExp>;
  };
  constructorOptions?: ConstructorOptions<T>;
  createImage?: (
    payload: CreateImagePayload,
    options: CreateImageOptions,
  ) => Promise<CreateImageResponse>;
  createVideo?: (
    payload: CreateVideoPayload,
    options: CreateVideoOptions,
  ) => Promise<CreateVideoResponse>;
  customClient?: CustomClientOptions<T>;
  debug?: {
    chatCompletion: () => boolean;
    responses?: () => boolean;
  };
  errorType?: {
    bizError: ILobeAgentRuntimeErrorType;
    invalidAPIKey: ILobeAgentRuntimeErrorType;
  };
  generateObject?: {
    /**
     * Transform schema before sending to the provider (e.g., filter unsupported properties)
     */
    handleSchema?: (schema: any) => any;
    /**
     * Transform Chat Completions payload before sending generateObject requests to the provider.
     */
    handlePayload?: (
      payload: GenerateObjectPayload,
      requestPayload: ChatCompletionCreateParamsWithPromptCacheKey,
      options: ConstructorOptions<T>,
    ) => ChatCompletionCreateParamsWithPromptCacheKey;
    /**
     * If true, route generateObject requests to Responses API path directly
     */
    useResponse?: boolean;
    /**
     * Allow only some models to use Responses API by simple matching.
     * If any string appears in model id or RegExp matches, Responses API is used.
     */
    useResponseModels?: Array<string | RegExp>;
    /**
     * Use tool calling to simulate structured output for providers that don't support native structured output
     */
    useToolsCalling?: boolean;
  };
  handleCreateVideoWebhook?: (
    payload: HandleCreateVideoWebhookPayload,
    options: CreateVideoOptions,
  ) => Promise<HandleCreateVideoWebhookResult>;
  handlePollVideoStatus?: (
    inferenceId: string,
    options: CreateVideoOptions,
  ) => Promise<PollVideoStatusResult>;
  models?:
    | ((params: { client: OpenAI }) => Promise<ChatModelCard[]>)
    | {
        transformModel?: (model: OpenAI.Model) => ChatModelCard;
      };
  /**
   * Additional provider-specific model patterns that support `prompt_cache_key`.
   * OpenAI models are handled by the factory default; other providers must opt in.
   */
  promptCacheKeyModels?: Array<string | RegExp>;
  provider: string;
  responses?: {
    handlePayload?: (
      payload: ChatStreamPayload,
      options: ConstructorOptions<T>,
    ) => ChatStreamPayload;
  };
}

export const createOpenAICompatibleRuntime = <T extends Record<string, any> = any>({
  provider,
  baseURL: DEFAULT_BASE_URL,
  apiKey: DEFAULT_API_KEY,
  errorType,
  debug: debugParams,
  constructorOptions,
  chatCompletion,
  models,
  customClient,
  responses,
  promptCacheKeyModels,
  createImage: customCreateImage,
  createVideo: customCreateVideo,
  handleCreateVideoWebhook: customHandleCreateVideoWebhook,
  handlePollVideoStatus: customHandlePollVideoStatus,
  generateObject: generateObjectConfig,
}: OpenAICompatibleFactoryOptions<T>) => {
  const ErrorType = {
    bizError: errorType?.bizError || AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: errorType?.invalidAPIKey || AgentRuntimeErrorType.InvalidProviderAPIKey,
  };

  return class LobeOpenAICompatibleAI implements LobeRuntimeAI {
    client!: OpenAI;

    private id: string;
    private logPrefix: string;
    private modelIdMappingOptions: ModelIdMappingOptions = {};

    baseURL!: string;
    protected _options: ConstructorOptions<T>;

    constructor(options: LobeClientOptions & Record<string, any> = {}) {
      const { modelIdMapping, ...inputOptions } = options as LobeClientOptions &
        Record<string, any> &
        ModelIdMappingOptions;
      const _options = {
        ...inputOptions,
        apiKey: inputOptions.apiKey?.trim() || DEFAULT_API_KEY,
        baseURL: inputOptions.baseURL?.trim() || DEFAULT_BASE_URL,
      };
      const { apiKey, baseURL = DEFAULT_BASE_URL, ...res } = _options;
      this._options = _options as ConstructorOptions<T>;
      this.modelIdMappingOptions = { modelIdMapping };

      if (!apiKey) throw AgentRuntimeError.createError(ErrorType?.invalidAPIKey);

      const initOptions = { apiKey, baseURL, ...constructorOptions, ...res };

      // if the custom client is provided, use it as client
      if (customClient?.createClient) {
        this.client = customClient.createClient(initOptions as any);
      } else {
        this.client = new OpenAI(initOptions);
      }

      this.baseURL = baseURL || this.client.baseURL;

      this.id = options.id || provider;
      this.logPrefix = `lobe-model-runtime:${this.id}`;
    }

    protected getMappedModelId(model: string) {
      return resolveMappedModelId(model, this.modelIdMappingOptions);
    }

    private withMappedRequestModel<TPayload extends { model?: string }>(
      requestPayload: TPayload,
      logicalModel: string,
    ): TPayload {
      if (!requestPayload.model) return requestPayload;

      const mappedModel = this.getMappedModelId(logicalModel);
      if (requestPayload.model !== logicalModel || mappedModel === requestPayload.model) {
        return requestPayload;
      }

      return { ...requestPayload, model: mappedModel };
    }

    /**
     * Determine if should use Responses API based on various configuration options
     * @param params - Configuration parameters
     * @returns true if should use Responses API, false otherwise
     */
    private shouldUseResponsesAPI(params: {
      /** Context for logging (e.g., 'chat', 'generateObject', 'tool calling') */
      context?: string;
      /** Factory/instance level useResponse flag */
      flagUseResponse?: boolean;
      /** Factory/instance level model patterns for Responses API */
      flagUseResponseModels?: Array<string | RegExp>;
      /** The model ID to check */
      model?: string;
      /** Explicit responseApi flag */
      responseApi?: boolean;
      /** User-specified API mode (highest priority) */
      userApiMode?: string;
    }): boolean {
      const {
        model,
        userApiMode,
        responseApi,
        flagUseResponse,
        flagUseResponseModels,
        context = 'operation',
      } = params;

      const log = debug(`${this.logPrefix}:shouldUseResponsesAPI`);

      // Priority 0: Check built-in Responses API model rules FIRST (highest priority)
      // These models MUST use Responses API regardless of user settings.
      if (model && isResponsesAPIModel(model)) {
        log('using Responses API: model %s matches built-in Responses API model rules', model);
        return true;
      }

      // Priority 1: userApiMode is explicitly set to 'chatCompletion' (user disabled the switch)
      if (userApiMode === 'chatCompletion') {
        log('using Chat Completions API: userApiMode=%s', userApiMode);
        return false;
      }

      // Priority 2: When user enables the switch (userApiMode === 'responses')
      // Check if useResponseModels is configured - if so, only matching models use Responses API
      // If useResponseModels is not configured, all models use Responses API
      if (userApiMode === 'responses') {
        if (model && flagUseResponseModels?.length) {
          const matches = flagUseResponseModels.some((m: string | RegExp) =>
            typeof m === 'string' ? model.includes(m) : (m as RegExp).test(model),
          );
          if (matches) {
            log(
              'using Responses API: userApiMode=responses and model %s matches useResponseModels',
              model,
            );
            return true;
          }
          log(
            'using Chat Completions API: userApiMode=responses but model %s does not match useResponseModels',
            model,
          );
          return false;
        }
        // No useResponseModels configured, use Responses API for all models
        log('using Responses API: userApiMode=responses (no useResponseModels filter)');
        return true;
      }

      // Priority 3: Explicit responseApi flag
      if (responseApi) {
        log('using Responses API: explicit responseApi flag for %s', context);
        return true;
      }

      // Priority 4: Factory/instance level useResponse flag
      if (flagUseResponse) {
        log('using Responses API: flagUseResponse=true for %s', context);
        return true;
      }

      // Priority 5: Check if model matches useResponseModels patterns (without user switch)
      if (model && flagUseResponseModels?.length) {
        const matches = flagUseResponseModels.some((m: string | RegExp) =>
          typeof m === 'string' ? model.includes(m) : (m as RegExp).test(model),
        );
        if (matches) {
          log('using Responses API: model %s matches useResponseModels config', model);
          return true;
        }
      }

      log('using Chat Completions API for %s', context);
      return false;
    }

    private resolvePromptCacheKey(model?: string, user?: string) {
      if (!user) return;

      // Keep the default key at {userId}:{model}; {agentId/topicId} can be added later if a narrower cache bucket is needed.
      if (model?.startsWith('gpt-') || /^o\d/.test(model || '') || model === 'chat-latest') {
        return `lobe:${user}:${model}`;
      }

      const matchesProviderPromptCacheModel = promptCacheKeyModels?.some((item) => {
        if (!model) return false;
        if (typeof item === 'string') return model.includes(item);

        item.lastIndex = 0;
        return item.test(model);
      });
      if (matchesProviderPromptCacheModel) {
        return `lobe:${user}:${model}`;
      }
    }

    private resolvePromptCacheKeyParams(
      model?: string,
      user?: string,
      existingPromptCacheKey?: string,
    ) {
      if (existingPromptCacheKey !== undefined) return {};

      const promptCacheKey = this.resolvePromptCacheKey(model, user);

      return promptCacheKey ? { prompt_cache_key: promptCacheKey } : {};
    }

    private handleGenerateObjectPayload(
      payload: GenerateObjectPayload,
      requestPayload: ChatCompletionCreateParamsWithPromptCacheKey,
    ) {
      return generateObjectConfig?.handlePayload
        ? generateObjectConfig.handlePayload(payload, requestPayload, this._options)
        : requestPayload;
    }

    async chat({ responseMode, ...payload }: ChatStreamPayload, options?: ChatMethodOptions) {
      try {
        const log = debug(`${this.logPrefix}:chat`);
        const inputStartAt = Date.now();

        log('chat called with model: %s, stream: %s', payload.model, payload.stream ?? true);

        // Normalize tool parameter schemas before they fan out to the
        // Chat-Completions / Responses paths. User MCP tools may emit boolean
        // sub-schemas (`items: true`) or array properties missing `type`, which
        // upstream validators (OpenAI/DeepSeek, Gemini) reject.
        if (payload.tools) payload.tools = normalizeToolsParameters(payload.tools as any) as any;

        let processedPayload: any = payload;
        const userApiMode = (payload as any).apiMode as string | undefined;
        const modelId = (payload as any).model as string | undefined;

        const instanceChat = ((this._options as any).chatCompletion || {}) as {
          useResponse?: boolean;
          useResponseModels?: Array<string | RegExp>;
        };
        const flagUseResponse =
          instanceChat.useResponse ?? (chatCompletion ? chatCompletion.useResponse : undefined);
        const flagUseResponseModels =
          instanceChat.useResponseModels ?? chatCompletion?.useResponseModels;

        // Determine if should use Responses API
        const shouldUseResponses = this.shouldUseResponsesAPI({
          context: 'chat',
          flagUseResponse,
          flagUseResponseModels,
          model: modelId,
          userApiMode,
        });

        if (shouldUseResponses) {
          processedPayload = { ...payload, apiMode: 'responses' } as any;
        }

        // Pre-flight: abort doomed requests before invoking handlePayload so
        // providers don't waste a round-trip to upstream just to get a 400.
        // See .
        if (chatCompletion?.contextPreFlight) {
          const { models: preFlightModels, ...preFlightOptions } = chatCompletion.contextPreFlight;
          assertContextWithinWindow(processedPayload, preFlightModels, preFlightOptions);
        }

        // Then perform factory-level processing
        const handledPayload = chatCompletion?.handlePayload
          ? chatCompletion.handlePayload(processedPayload, this._options)
          : ({
              ...processedPayload,
              stream: processedPayload.stream ?? true,
            } as OpenAI.ChatCompletionCreateParamsStreaming);

        if ((handledPayload as any).apiMode === 'responses') {
          return await this.handleResponseAPIMode(processedPayload, options, payload.model);
        }

        // Sanitize temperature/top_p conflict for Claude 4+ models routed via OpenAI-compatible API.
        // normalizeTemperature is false here because OpenAI-compatible providers use the raw range.
        const postPayload = {
          ...handledPayload,
          ...resolveModelSamplingParameters(handledPayload.model, handledPayload, {
            normalizeTemperature: false,
            preferTemperature: true,
          }),
        };

        const computedBaseURL =
          typeof this._options.baseURL === 'string' && this._options.baseURL
            ? this._options.baseURL.trim()
            : typeof DEFAULT_BASE_URL === 'string'
              ? DEFAULT_BASE_URL
              : undefined;
        const targetBaseURL = computedBaseURL || this.baseURL;

        if (targetBaseURL !== this.baseURL) {
          const restOptions = {
            ...(this._options as ConstructorOptions<T> & Record<string, any>),
          } as Record<string, any>;
          const optionApiKey = restOptions.apiKey;
          delete restOptions.apiKey;
          delete restOptions.baseURL;
          delete restOptions.modelIdMapping;

          const sanitizedApiKey = optionApiKey?.toString().trim() || DEFAULT_API_KEY;

          const nextOptions = {
            ...restOptions,
            apiKey: sanitizedApiKey,
            baseURL: targetBaseURL,
          } as ConstructorOptions<T>;

          const initOptions = {
            apiKey: sanitizedApiKey,
            baseURL: targetBaseURL,
            ...constructorOptions,
            ...restOptions,
          } as ConstructorOptions<T> & Record<string, any>;

          this._options = nextOptions;

          if (customClient?.createClient) {
            this.client = customClient.createClient(initOptions);
          } else {
            this.client = new OpenAI(initOptions);
          }

          this.baseURL = targetBaseURL;
        }

        const messages = await convertOpenAIMessages(postPayload.messages, {
          forceImageBase64: chatCompletion?.forceImageBase64,
          forceVideoBase64: chatCompletion?.forceVideoBase64,
          model: postPayload.model,
        });
        const includeUsageRequested = Boolean(postPayload.stream && !chatCompletion?.excludeUsage);

        let response: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;

        const streamOptions: OpenAIStreamOptions = {
          bizErrorTypeTransformer: chatCompletion?.handleStreamBizErrorType,
          callbacks: options?.callback,
          payload: {
            apiMode: 'chat_completions',
            includeUsageRequested,
            model: payload.model,
            pricing: await getModelPricing(payload.model, this.id, options?.pricingContext),
            provider: this.id,
          },
        };

        if (customClient?.createChatCompletionStream) {
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

          response = customClient.createChatCompletionStream(
            this.client,
            this.withMappedRequestModel(customRequestPayload, payload.model),
            this,
          ) as any;
        } else {
          // Remove LobeHub-internal fields before sending to downstream API.
          // `preserveThinking` is only consumed by Qwen/Zhipu handlePayload (which runs above)
          // and must not leak to other providers' APIs as an unknown parameter.
          const { apiMode: _, preserveThinking: _pt, ...cleanedPayload } = postPayload as any;
          const finalPayload = {
            ...cleanedPayload,
            messages,
            ...(chatCompletion?.noUserId ? {} : { user: options?.user }),
            ...this.resolvePromptCacheKeyParams(
              cleanedPayload.model,
              options?.user,
              cleanedPayload.prompt_cache_key,
            ),
            stream_options: includeUsageRequested ? { include_usage: true } : undefined,
          };
          const requestPayload = this.withMappedRequestModel(finalPayload, payload.model);

          log('sending chat completion request with %d messages', messages.length);

          if (debugParams?.chatCompletion?.()) {
            // eslint-disable-next-line no-console
            console.log('[requestPayload]');
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(requestPayload), '\n');
          }

          response = (await this.client.chat.completions.create(requestPayload, {
            // https://github.com/lobehub/lobe-chat/pull/318
            headers: { Accept: '*/*', ...options?.requestHeaders },
            signal: options?.signal,
          })) as unknown as Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
        }

        if (postPayload.stream) {
          log('processing streaming response');
          const [prod, useForDebug] = response.tee();

          if (debugParams?.chatCompletion?.()) {
            const useForDebugStream =
              useForDebug instanceof ReadableStream ? useForDebug : useForDebug.toReadableStream();

            debugStream(useForDebugStream).catch(console.error);
          }

          return StreamingResponse(
            chatCompletion?.handleStream
              ? chatCompletion.handleStream(prod, {
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

        if (debugParams?.chatCompletion?.()) {
          debugResponse(response);
        }

        if (responseMode === 'json') {
          log('returning JSON response mode');
          return Response.json(response);
        }

        log('transforming non-streaming response to stream');
        const transformHandler =
          chatCompletion?.handleTransformResponseToStream || transformResponseToStream;
        const stream = transformHandler(response as unknown as OpenAI.ChatCompletion);

        return StreamingResponse(
          chatCompletion?.handleStream
            ? chatCompletion.handleStream(stream, {
                callbacks: streamOptions.callbacks,
                inputStartAt,
                payload: streamOptions.payload,
              })
            : OpenAIStream(stream, { ...streamOptions, enableStreaming: false, inputStartAt }),
          {
            headers: options?.headers,
          },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async createImage(payload: CreateImagePayload, options?: CreateImageMethodOptions) {
      const log = debug(`${this.logPrefix}:createImage`);

      // If custom createImage implementation is provided, use it
      if (customCreateImage) {
        log('using custom createImage implementation');
        return customCreateImage(payload, {
          ...this._options,
          apiKey: this._options.apiKey!,
          modelIdMapping: this.modelIdMappingOptions.modelIdMapping,
          provider,
        });
      }

      log('using default createOpenAICompatibleImage');
      // Use the new createOpenAICompatibleImage function
      return createOpenAICompatibleImage(this.client, payload, this.id, {
        pricingContext: options?.pricingContext,
        pricingModel: payload.model,
        requestModel: resolveMappedModelId(payload.model, this.modelIdMappingOptions),
        routingModel: payload.model,
      });
    }

    async createVideo(payload: CreateVideoPayload) {
      const log = debug(`${this.logPrefix}:createVideo`);

      if (customCreateVideo) {
        log('using custom createVideo implementation');
        return customCreateVideo(payload, {
          ...this._options,
          apiKey: this._options.apiKey!,
          modelIdMapping: this.modelIdMappingOptions.modelIdMapping,
          provider,
        });
      }

      log('using default createOpenAICompatibleVideo');
      return createOpenAICompatibleVideo(payload, {
        ...this._options,
        apiKey: this._options.apiKey!,
        baseURL: this._options.baseURL || '',
        modelIdMapping: this.modelIdMappingOptions.modelIdMapping,
        provider,
      });
    }

    async handleCreateVideoWebhook(payload: HandleCreateVideoWebhookPayload) {
      if (!customHandleCreateVideoWebhook) {
        throw new Error('handleCreateVideoWebhook is not supported by this provider');
      }
      return customHandleCreateVideoWebhook(payload, {
        ...this._options,
        apiKey: this._options.apiKey!,
        provider,
      });
    }

    async handlePollVideoStatus(inferenceId: string): Promise<PollVideoStatusResult> {
      const log = debug(`${this.logPrefix}:handlePollVideoStatus`);

      if (customHandlePollVideoStatus) {
        log('using custom handlePollVideoStatus implementation');
        return customHandlePollVideoStatus(inferenceId, {
          ...this._options,
          apiKey: this._options.apiKey!,
          provider,
        });
      }

      log('using default pollOpenAICompatibleVideoStatus');
      return pollOpenAICompatibleVideoStatus(inferenceId, {
        ...this._options,
        apiKey: this._options.apiKey!,
        baseURL: this._options.baseURL || '',
        provider,
      });
    }

    async models() {
      const log = debug(`${this.logPrefix}:models`);
      log('fetching available models');

      let resultModels: ChatModelCard[];
      if (typeof models === 'function') {
        log('using custom models function');
        resultModels = await models({ client: this.client });
      } else {
        log('fetching models from client API');
        const list = await this.client.models.list();
        resultModels = list.data
          .filter((model) => {
            return CHAT_MODELS_BLOCK_LIST.every(
              (keyword) => !model.id.toLowerCase().includes(keyword),
            );
          })
          .map((item) => {
            if (models?.transformModel) {
              return models.transformModel(item);
            }

            const toReleasedAt = () => {
              if (!item.created) return;
              dayjs.extend(utc);

              // guarantee item.created in Date String format
              if (
                typeof (item.created as any) === 'string' ||
                // or in milliseconds
                item.created.toFixed(0).length === 13
              ) {
                return dayjs.utc(item.created).format('YYYY-MM-DD');
              }

              // by default, the created time is in seconds
              return dayjs.utc(item.created * 1000).format('YYYY-MM-DD');
            };

            // TODO: should refactor after remove v1 user/modelList code
            const knownModel = LOBE_DEFAULT_MODEL_LIST.find((model) => model.id === item.id);

            if (knownModel) {
              const releasedAt = knownModel.releasedAt ?? toReleasedAt();

              return { ...knownModel, releasedAt };
            }

            return {
              id: item.id,
              releasedAt: toReleasedAt(),
            };
          })

          .filter(Boolean) as ChatModelCard[];
      }

      log('fetched %d models', resultModels.length);

      return await postProcessModelList(resultModels, (modelId) =>
        getModelPropertyWithFallback<AiModelType>(modelId, 'type'),
      );
    }

    /**
     * Simulate schema-based structured output through a forced tool call, for
     * providers that do not support `response_format: { type: 'json_schema' }`.
     * Returns the parsed schema object — the same shape as the json_schema path.
     */
    private async generateObjectViaToolCalling(
      payload: GenerateObjectPayload,
      options: GenerateObjectOptions | undefined,
      usagePayload: Parameters<typeof convertOpenAIUsage>[1],
    ) {
      const { messages, schema, model } = payload;

      // Apply schema transformation if configured
      const processedSchema = generateObjectConfig?.handleSchema
        ? { ...schema!, schema: generateObjectConfig.handleSchema(schema!.schema) }
        : schema!;

      const tool: ChatCompletionTool = {
        function: {
          description:
            processedSchema.description ||
            'Generate structured output according to the provided schema',
          name: processedSchema.name || 'structured_output',
          parameters: processedSchema.schema,
        },
        type: 'function',
      };

      const res = await this.client.chat.completions.create(
        this.withMappedRequestModel(
          this.handleGenerateObjectPayload(payload, {
            ...getGenerateObjectReasoningParams(payload),
            messages,
            model,
            ...this.resolvePromptCacheKeyParams(model, options?.user),
            tool_choice: { function: { name: tool.function.name }, type: 'function' },
            tools: [tool],
            user: options?.user,
          }),
          payload.model,
        ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        { headers: options?.headers, signal: options?.signal },
      );

      if (res.usage) {
        await options?.onUsage?.(convertOpenAIUsage(res.usage, usagePayload));
      }

      // Structural type keeps this compatible across openai SDK majors (v6
      // widened tool_calls to a function/custom union).
      const toolCalls = res.choices[0].message.tool_calls as
        | { function?: { arguments: string; name: string } }[]
        | undefined;
      const toolCall =
        toolCalls?.find((item) => item.function?.name === tool.function.name) ?? toolCalls?.[0];

      if (!toolCall?.function) {
        // tool_choice forces this function, so a missing tool call means the
        // provider misbehaved — surface it instead of silently returning undefined
        console.error('no tool call found in structured output response:', res.choices[0]?.message);
        return undefined;
      }

      try {
        return JSON.parse(toolCall.function.arguments);
      } catch {
        console.error('parse tool call arguments error:', toolCall);
        return undefined;
      }
    }

    async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
      try {
        const { messages, schema, model, responseApi, tools } = payload;

        const log = debug(`${this.logPrefix}:generateObject`);
        log(
          'generateObject called with model: %s, hasTools: %s, hasSchema: %s',
          model,
          !!tools,
          !!schema,
        );

        const pricing = await getModelPricing(model, this.id, options?.pricingContext);
        const usagePayload = { model, pricing, provider: this.id };

        if (tools) {
          log('using tools-based generation');
          return this.generateObjectWithTools(payload, options, usagePayload);
        }

        if (!schema) throw new Error('tools or schema is required');

        // Use tool calling fallback if configured, or when the model is known to
        // reject `response_format: { type: 'json_schema' }`. The DeepSeek API only
        // supports `json_object` and replies `400 This response_format type is
        // unavailable now` to json_schema requests, so DeepSeek-family models served
        // through generic OpenAI-compatible providers (aggregator gateways, custom
        // endpoints) must simulate structured output via forced tool calling.
        if (generateObjectConfig?.useToolsCalling || detectModelProvider(model) === 'deepseek') {
          log('using tool calling fallback for structured output');
          return await this.generateObjectViaToolCalling(payload, options, usagePayload);
        }

        // Factory-level Responses API routing control (supports instance override)
        const instanceGenerateObject = ((this._options as any).generateObject || {}) as {
          useResponse?: boolean;
          useResponseModels?: Array<string | RegExp>;
        };
        const flagUseResponse =
          instanceGenerateObject.useResponse ??
          (generateObjectConfig ? generateObjectConfig.useResponse : undefined);
        const flagUseResponseModels =
          instanceGenerateObject.useResponseModels ?? generateObjectConfig?.useResponseModels;

        const shouldUseResponses = this.shouldUseResponsesAPI({
          context: 'generateObject',
          flagUseResponse,
          flagUseResponseModels,
          model,
          responseApi,
        });

        // Apply schema transformation if configured
        const processedSchema = generateObjectConfig?.handleSchema
          ? { ...schema, schema: generateObjectConfig.handleSchema(schema.schema) }
          : schema;

        if (shouldUseResponses) {
          log('calling responses.create for structured output');
          const res = await this.client!.responses.create(
            this.withMappedRequestModel(
              {
                input: messages,
                model,
                ...getGenerateObjectResponsesReasoningParams(payload),
                ...this.resolvePromptCacheKeyParams(model, options?.user),
                text: { format: { strict: true, type: 'json_schema', ...processedSchema } },
                // Responses API replaced `user` with `safety_identifier`; some endpoints reject `user`
                safety_identifier: options?.user,
              } as any,
              model,
            ),
            { headers: options?.headers, signal: options?.signal },
          );

          if (res.usage) {
            await options?.onUsage?.(convertOpenAIResponseUsage(res.usage, usagePayload));
          }

          const text = res.output_text;
          log('received structured output from Responses API, length: %d', text?.length || 0);
          try {
            const result = JSON.parse(text);
            log('successfully parsed JSON output');
            return result;
          } catch (error) {
            log('failed to parse JSON output: %O', error);
            console.error('parse json error:', text);
            return undefined;
          }
        }

        log('calling chat.completions.create for structured output');
        let res: OpenAI.ChatCompletion;
        try {
          res = await this.client.chat.completions.create(
            this.withMappedRequestModel(
              this.handleGenerateObjectPayload(payload, {
                ...getGenerateObjectReasoningParams(payload),
                messages,
                model,
                response_format: { json_schema: processedSchema, type: 'json_schema' },
                ...this.resolvePromptCacheKeyParams(model, options?.user),
                user: options?.user,
              }),
              model,
            ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
            { headers: options?.headers, signal: options?.signal },
          );
        } catch (error) {
          // Gateways can serve json_schema-incapable upstreams under arbitrary
          // model ids (e.g. OpenCode Zen's `big-pickle` proxies DeepSeek), which
          // the model-id detection above cannot catch. Retry once via forced
          // tool calling when the upstream rejects the response_format type.
          if (!isResponseFormatUnsupportedError(error)) throw error;

          log('provider rejected json_schema response_format, retrying via tool calling');
          return await this.generateObjectViaToolCalling(payload, options, usagePayload);
        }
        if (res.usage) {
          await options?.onUsage?.(convertOpenAIUsage(res.usage, usagePayload));
        }

        const text = res.choices[0].message.content!;

        log('received structured output from Chat Completions API, length: %d', text?.length || 0);

        try {
          const result = JSON.parse(text);
          log('successfully parsed JSON output');
          return result;
        } catch (error) {
          log('failed to parse JSON output: %O', error);
          console.error('parse json error:', text);
          return undefined;
        }
      } catch (error) {
        const handledError = this.handleError(error);

        if (
          handledError.errorType === AgentRuntimeErrorType.AgentRuntimeError ||
          handledError.errorType === ErrorType.bizError
        ) {
          throw error;
        }

        throw handledError;
      }
    }

    async embeddings(
      payload: EmbeddingsPayload,
      options?: EmbeddingsOptions,
    ): Promise<Embeddings[]> {
      const log = debug(`${this.logPrefix}:embeddings`);
      const requestPayload = withMappedModelId(payload, this.modelIdMappingOptions);
      log(
        'embeddings called with model: %s, input items: %d',
        payload.model,
        Array.isArray(payload.input) ? payload.input.length : 1,
      );

      try {
        const res = await this.client.embeddings.create(
          { ...requestPayload, encoding_format: 'float', user: options?.user },
          { headers: options?.headers, signal: options?.signal },
        );

        if (res.usage && options?.onUsage) {
          const pricing = await getModelPricing(payload.model, this.id, options?.pricingContext);
          await options.onUsage(
            convertOpenAIUsage(res.usage as any, {
              model: payload.model,
              pricing,
              provider: this.id,
            }),
          );
        }

        log('received %d embeddings', res.data.length);
        return res.data.map((item) => item.embedding);
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async textToSpeech(payload: TextToSpeechPayload, options?: TextToSpeechOptions) {
      const log = debug(`${this.logPrefix}:textToSpeech`);
      const requestPayload = withMappedModelId(payload, this.modelIdMappingOptions);
      log(
        'textToSpeech called with input length: %d, voice: %s',
        payload.input?.length || 0,
        payload.voice,
      );

      try {
        const mp3 = await this.client.audio.speech.create(requestPayload as any, {
          headers: options?.headers,
          signal: options?.signal,
        });
        const buffer = await mp3.arrayBuffer();
        log('generated audio with size: %d bytes', buffer.byteLength);
        return buffer;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async transcribe(payload: ASRPayload, options?: ASROptions): Promise<ASRResponse> {
      const log = debug(`${this.logPrefix}:transcribe`);
      const { file, fileName, model, language, prompt, responseFormat, temperature } = payload;
      const requestModel = withMappedModelId(payload, this.modelIdMappingOptions).model;
      log('transcribe called with model: %s, audio size: %d bytes', model, file?.size || 0);

      try {
        // The OpenAI SDK only accepts `File` uploads; wrap bare blobs so the
        // provider can infer the audio format from the file extension.
        const uploadFile =
          file instanceof File ? file : new File([file], fileName || 'audio', { type: file.type });

        const transcription = await this.client.audio.transcriptions.create(
          {
            file: uploadFile,
            language,
            model: requestModel,
            prompt,
            response_format: responseFormat,
            temperature,
          },
          { headers: options?.headers, signal: options?.signal },
        );

        const text =
          typeof transcription === 'string' ? transcription : ((transcription as any).text ?? '');
        log('transcription completed, text length: %d', text.length);

        return { text };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    protected handleError(error: any): ChatCompletionErrorPayload {
      const log = debug(`${this.logPrefix}:error`);
      log('handling error: %O', error);

      let desensitizedEndpoint = this.baseURL;

      // refs: https://github.com/lobehub/lobe-chat/issues/842
      if (this.baseURL !== DEFAULT_BASE_URL) {
        desensitizedEndpoint = desensitizeUrl(this.baseURL);
      }

      // Pre-flight context-window failures get a structured payload so the
      // UI can offer fork / switch-model affordances instead of surfacing a
      // raw provider 400. See .
      if (error instanceof ContextExceededPreFlightError) {
        log('pre-flight context exceeded: %s', error.message);
        return AgentRuntimeError.chat({
          endpoint: desensitizedEndpoint,
          error: error.toPayload(),
          errorType: AgentRuntimeErrorType.ExceededContextWindow,
          message: error.message,
          provider: this.id,
        });
      }

      if (chatCompletion?.handleError) {
        log('using custom error handler');
        const errorResult = chatCompletion.handleError(error, this._options);

        if (errorResult)
          return AgentRuntimeError.chat({
            ...errorResult,
            provider: this.id,
          } as ChatCompletionErrorPayload);
      }

      if ('status' in (error as any)) {
        const status = (error as Response).status;
        log('HTTP error with status: %d', status);

        switch (status) {
          case 401: {
            log('invalid API key error');
            return AgentRuntimeError.chat({
              endpoint: desensitizedEndpoint,
              error: error as any,
              errorType: ErrorType.invalidAPIKey,
              provider: this.id,
            });
          }

          default: {
            break;
          }
        }
      }

      const { errorResult, RuntimeError, message } = handleOpenAIError(error);

      log('error code: %s, message: %s', errorResult.code, errorResult.message);

      switch (errorResult.code) {
        case 'insufficient_quota': {
          log('insufficient quota error');
          return AgentRuntimeError.chat({
            endpoint: desensitizedEndpoint,
            error: errorResult,
            errorType: AgentRuntimeErrorType.InsufficientQuota,
            message,
            provider: this.id,
          });
        }

        case 'model_not_found': {
          log('model not found error');
          return AgentRuntimeError.chat({
            endpoint: desensitizedEndpoint,
            error: errorResult,
            errorType: AgentRuntimeErrorType.ModelNotFound,
            message,
            provider: this.id,
          });
        }

        // content too long
        case 'context_length_exceeded':
        case 'string_above_max_length': {
          log('context length exceeded error');
          return AgentRuntimeError.chat({
            endpoint: desensitizedEndpoint,
            error: errorResult,
            errorType: AgentRuntimeErrorType.ExceededContextWindow,
            message,
            provider: this.id,
          });
        }
      }

      const errorMsg = errorResult.error?.message || errorResult.message;

      if (ErrorClassifier.isAccountDeactivated(errorMsg)) {
        log('account deactivated error detected from message');
        return AgentRuntimeError.chat({
          endpoint: desensitizedEndpoint,
          error: errorResult,
          errorType: AgentRuntimeErrorType.AccountDeactivated,
          message,
          provider: this.id,
        });
      }

      if (ErrorClassifier.isInsufficientQuota(errorMsg)) {
        log('insufficient quota error detected from message');
        return AgentRuntimeError.chat({
          endpoint: desensitizedEndpoint,
          error: errorResult,
          errorType: AgentRuntimeErrorType.InsufficientQuota,
          message,
          provider: this.id,
        });
      }

      if (ErrorClassifier.isExceededContextWindow(errorMsg)) {
        log('context length exceeded detected from message');
        return AgentRuntimeError.chat({
          endpoint: desensitizedEndpoint,
          error: errorResult,
          errorType: AgentRuntimeErrorType.ExceededContextWindow,
          message,
          provider: this.id,
        });
      }

      if (ErrorClassifier.isRateLimitExceeded(errorMsg)) {
        log('quota limit reached detected from message');
        return AgentRuntimeError.chat({
          endpoint: desensitizedEndpoint,
          error: errorResult,
          errorType: AgentRuntimeErrorType.RateLimitExceeded,
          message,
          provider: this.id,
        });
      }

      log('returning generic error');
      return AgentRuntimeError.chat({
        endpoint: desensitizedEndpoint,
        error: errorResult,
        errorType: RuntimeError || ErrorType.bizError,
        message,
        provider: this.id,
      });
    }

    private async handleResponseAPIMode(
      payload: ChatStreamPayload,
      options?: ChatMethodOptions,
      usageModel = payload.model,
    ): Promise<Response> {
      const log = debug(`${this.logPrefix}:handleResponseAPIMode`);
      log('handleResponseAPIMode called with model: %s', payload.model);

      const inputStartAt = Date.now();

      const { messages, reasoning_effort, tools, reasoning, responseMode, max_tokens, ...res } =
        responses?.handlePayload
          ? (responses?.handlePayload(payload, this._options) as ChatStreamPayload)
          : payload;

      // remove penalty params and chat completion specific params
      delete res.apiMode;
      delete res.frequency_penalty;
      delete res.presence_penalty;
      delete res.preserveThinking;

      const input = await convertOpenAIResponseInputs(messages as any, {
        forceImageBase64: chatCompletion?.forceImageBase64,
        forceVideoBase64: chatCompletion?.forceVideoBase64,
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
        ...res,
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
        tools: tools?.map((tool) => this.convertChatCompletionToolToResponseTool(tool)),
        ...this.resolvePromptCacheKeyParams(
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
      const requestPayload = this.withMappedRequestModel(postPayload, usageModel);

      if (debugParams?.responses?.()) {
        // eslint-disable-next-line no-console
        console.log('[requestPayload]');
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(requestPayload), '\n');
      }

      log('sending responses.create request');

      const response = await this.client.responses.create(requestPayload, {
        headers: options?.requestHeaders,
        signal: options?.signal,
      });

      const streamOptions: OpenAIStreamOptions = {
        bizErrorTypeTransformer: chatCompletion?.handleStreamBizErrorType,
        callbacks: options?.callback,
        payload: {
          apiMode: 'responses',
          model: usageModel,
          pricing: await getModelPricing(usageModel, this.id, options?.pricingContext),
          provider: this.id,
        },
      };

      if (isStreaming) {
        log('processing streaming Responses API response');
        const stream = response as Stream<OpenAI.Responses.ResponseStreamEvent>;
        const [prod, useForDebug] = stream.tee();

        if (debugParams?.responses?.()) {
          const useForDebugStream =
            useForDebug instanceof ReadableStream ? useForDebug : useForDebug.toReadableStream();

          debugStream(useForDebugStream).catch(console.error);
        }

        return StreamingResponse(OpenAIResponsesStream(prod, { ...streamOptions, inputStartAt }), {
          headers: options?.headers,
        });
      }

      log('processing non-streaming Responses API response');

      // Handle non-streaming response
      if (debugParams?.responses?.()) {
        debugResponse(response);
      }

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
    }

    private convertChatCompletionToolToResponseTool = (
      tool: ChatCompletionTool,
    ): OpenAI.Responses.Tool => {
      return { type: tool.type, ...tool.function } as any;
    };

    private async generateObjectWithTools(
      payload: GenerateObjectPayload,
      options?: GenerateObjectOptions,
      usagePayload?: ChatPayloadForTransformStream,
    ) {
      const { messages, model, tools, responseApi } = payload;
      const log = debug(`${this.logPrefix}:generateObject`);

      log(
        'generateObjectWithTools called with model: %s, toolsCount: %d',
        model,
        tools?.length || 0,
      );

      // Factory-level Responses API routing control (supports instance override)
      const instanceGenerateObject = ((this._options as any).generateObject || {}) as {
        useResponse?: boolean;
        useResponseModels?: Array<string | RegExp>;
      };
      const flagUseResponse =
        instanceGenerateObject.useResponse ??
        (generateObjectConfig ? generateObjectConfig.useResponse : undefined);
      const flagUseResponseModels =
        instanceGenerateObject.useResponseModels ?? generateObjectConfig?.useResponseModels;

      const shouldUseResponses = this.shouldUseResponsesAPI({
        context: 'tool calling',
        flagUseResponse,
        flagUseResponseModels,
        model,
        responseApi,
      });

      if (shouldUseResponses) {
        log('calling responses.create for tool calling');
        const input = await convertOpenAIResponseInputs(messages as any, {
          forceImageBase64: chatCompletion?.forceImageBase64,
          forceVideoBase64: chatCompletion?.forceVideoBase64,
          strictToolPairing: true,
        });

        const res = await this.client.responses.create(
          this.withMappedRequestModel(
            {
              input,
              model,
              ...this.resolvePromptCacheKeyParams(model, options?.user),
              tool_choice: 'required',
              tools: tools!.map((tool) => this.convertChatCompletionToolToResponseTool(tool)),
              // Responses API replaced `user` with `safety_identifier`; some endpoints reject `user`
              safety_identifier: options?.user,
            } as any,
            payload.model,
          ),
          { headers: options?.headers, signal: options?.signal },
        );

        if (res.usage) {
          await options?.onUsage?.(convertOpenAIResponseUsage(res.usage, usagePayload));
        }

        const functionCalls = res.output?.filter((item: any) => item.type === 'function_call');

        log('received %d function calls from Responses API', functionCalls?.length || 0);

        try {
          const result = functionCalls?.map((item: any) => ({
            arguments:
              typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments,
            name: item.name,
          }));
          log(
            'successfully parsed function calls: %O',
            result?.map((r) => r.name),
          );
          return result;
        } catch (error) {
          log('failed to parse tool call arguments: %O', error);
          console.error('parse tool call arguments error:', res);
          return undefined;
        }
      }

      log('calling chat.completions.create for tool calling');
      const msgs = messages;

      const res = await this.client.chat.completions.create(
        this.withMappedRequestModel(
          this.handleGenerateObjectPayload(payload, {
            ...getGenerateObjectReasoningParams(payload),
            messages: msgs,
            model,
            ...this.resolvePromptCacheKeyParams(model, options?.user),
            tool_choice: 'required',
            tools,
            user: options?.user,
          }),
          payload.model,
        ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        { headers: options?.headers, signal: options?.signal },
      );

      if (res.usage) {
        await options?.onUsage?.(convertOpenAIUsage(res.usage, usagePayload));
      }

      const toolCalls = res.choices[0].message.tool_calls!;

      log('received %d tool calls from Chat Completions API', toolCalls?.length || 0);

      try {
        const result = toolCalls.map((item) => {
          // OpenAI SDK v6 made tool calls a function|custom union; lobehub only emits function calls.
          const { function: fn } = item as OpenAI.ChatCompletionMessageFunctionToolCall;
          return {
            arguments: JSON.parse(fn.arguments),
            name: fn.name,
          };
        });
        log(
          'successfully parsed tool calls: %O',
          result.map((r) => r.name),
        );
        return result;
      } catch (error) {
        log('failed to parse tool call arguments: %O', error);
        console.error('parse tool call arguments error:', res);
        return undefined;
      }
    }
  };
};
