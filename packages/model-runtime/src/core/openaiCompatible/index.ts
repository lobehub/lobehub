import debug from 'debug';
import type OpenAI from 'openai';

import type {
  ASROptions,
  ASRPayload,
  ASRResponse,
  ChatCompletionErrorPayload,
  ChatMethodOptions,
  ChatStreamPayload,
  Embeddings,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  TextToSpeechOptions,
  TextToSpeechPayload,
} from '../../types';
import type { CreateImageMethodOptions, CreateImagePayload } from '../../types/image';
import type {
  CreateVideoPayload,
  CreateVideoResult,
  HandleCreateVideoWebhookPayload,
  PollVideoStatusResult,
  VideoGenerationCapabilities,
} from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';
import { getModelPricing } from '../../utils/getModelPricing';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { resolveMappedModelId, withMappedModelId } from '../../utils/modelIdMapping';
import { assertContextWithinWindow } from '../../utils/resolveSafeMaxTokens';
import {
  createSignatureChannelId,
  createSignatureScope,
  getRuntimeSignatureScopeSource,
  type SignatureScopeKind,
} from '../../utils/signatureScope';
import type { LobeRuntimeAI } from '../BaseAI';
import { normalizeToolsParameters } from '../contextBuilders/normalizeToolSchema';
import { chatViaChatCompletions } from '../protocols/openaiChatCompletions/chat';
import { chatViaResponses } from '../protocols/openaiResponses/chat';
import { convertOpenAITranscriptionUsage, convertOpenAIUsage } from '../usageConverters/openai';
import {
  resolvePromptCacheKey,
  shouldUseResponsesAPI,
  type ShouldUseResponsesAPIParams,
} from './apiMode';
import { OpenAICompatibleClient } from './client';
import type { OpenAICompatibleRuntimeContext } from './context';
import { createOpenAICompatibleImage } from './createImage';
import { createOpenAICompatibleVideo, pollOpenAICompatibleVideoStatus } from './createVideo';
import { createDecision } from './decide';
import { mapOpenAICompatibleError, resolveErrorTypes } from './errors';
import type {
  ConstructorOptions,
  LobeClientOptions,
  OpenAICompatibleFactoryOptions,
  ResponseCreateParamsWithPromptCacheKey,
} from './factoryOptions';
import { generateObject as runGenerateObject } from './generateObject';
import { listOpenAICompatibleModels } from './models';
import { createOpenAICompatibleSpeech } from './textToSpeech';

export type { PollVideoStatusResult };
export { isResponseFormatUnsupportedError } from '../protocols/openaiChatCompletions/generateObject';
export * from '../protocols/openaiChatCompletions/nonStreamToStream';
export * from '../protocols/openaiResponses/nonStreamToStream';
export * from './createVideo';
export type {
  CreateImageOptions,
  CreateVideoOptions,
  CustomClientOptions,
  OpenAICompatibleFactoryOptions,
} from './factoryOptions';
export { CHAT_MODELS_BLOCK_LIST } from './models';

export const createOpenAICompatibleRuntime = <T extends Record<string, any> = any>(
  factory: OpenAICompatibleFactoryOptions<T>,
) => {
  const {
    provider,
    baseURL: DEFAULT_BASE_URL,
    apiKey: DEFAULT_API_KEY,
    constructorOptions,
    chatCompletion,
    customClient,
    responses,
    promptCacheKeyModels,
    createImage: customCreateImage,
    createVideo: customCreateVideo,
    decide: decideConfig,
    videoGenerationCapabilities,
    handleCreateVideoWebhook: customHandleCreateVideoWebhook,
    handlePollVideoStatus: customHandlePollVideoStatus,
  } = factory;
  const ErrorType = resolveErrorTypes(factory);

  return class LobeOpenAICompatibleAI implements LobeRuntimeAI {
    client!: OpenAI;

    private id: string;
    private logPrefix: string;
    private modelIdMappingOptions: ModelIdMappingOptions = {};
    private subscriptionChannelId?: Promise<string>;

    baseURL!: string;
    decide?: LobeRuntimeAI['decide'];
    protected _options: ConstructorOptions<T>;

    getVideoGenerationCapabilities(model: string): VideoGenerationCapabilities {
      const requestModel = resolveMappedModelId(model, this.modelIdMappingOptions);

      return typeof videoGenerationCapabilities === 'function'
        ? videoGenerationCapabilities(requestModel)
        : (videoGenerationCapabilities ?? { completionModes: ['polling'] });
    }

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
        this.client = new OpenAICompatibleClient(initOptions);
      }

      this.baseURL = baseURL || this.client.baseURL;

      this.id = options.id || provider;
      if (typeof inputOptions.chatgptAccountId === 'string') {
        this.subscriptionChannelId = createSignatureChannelId(
          'chatgpt-account',
          inputOptions.chatgptAccountId,
        );
      }
      this.logPrefix = `lobe-model-runtime:${this.id}`;

      if (decideConfig) {
        this.decide = (payload, decideOptions) =>
          createDecision(this.client, payload, decideOptions, {
            ...decideConfig,
            handleError: (error) => this.handleError(error),
            modelIdMappingOptions: this.modelIdMappingOptions,
            provider: this.id,
          });
      }
    }

    /**
     * Direct endpoints use an irreversible endpoint/credential fingerprint, while
     * RouterRuntime injects its stable route and channel identity through a WeakMap.
     */
    private async getSignatureScope(
      model: string,
      kind: SignatureScopeKind,
      protocol: 'chat_completions' | 'responses',
    ) {
      const runtimeSource = getRuntimeSignatureScopeSource(this);
      let directChannelId: string | undefined;
      if (!runtimeSource) {
        if (this.subscriptionChannelId) {
          directChannelId = await this.subscriptionChannelId;
        } else if (this._options.apiKey) {
          directChannelId = await createSignatureChannelId(this.baseURL, this._options.apiKey);
        }
      }

      return createSignatureScope({
        kind,
        model,
        protocol,
        source:
          runtimeSource ??
          (directChannelId
            ? {
                apiType: 'openai',
                channelId: directChannelId,
                provider: this.id,
              }
            : undefined),
      });
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

    private prepareResponsesRequest(
      requestPayload: ResponseCreateParamsWithPromptCacheKey,
      logicalModel: string,
    ) {
      const mappedRequestPayload = this.withMappedRequestModel(requestPayload, logicalModel);
      return (
        responses?.prepareRequest?.(mappedRequestPayload, this._options) || {
          payload: mappedRequestPayload,
        }
      );
    }

    private resolvePromptCacheKey(model?: string, user?: string) {
      return resolvePromptCacheKey(model, user, promptCacheKeyModels);
    }

    private shouldUseResponsesAPI(params: ShouldUseResponsesAPIParams) {
      return shouldUseResponsesAPI(params, this.logPrefix);
    }

    /** What the protocol modules read; built per call so it always reflects current state. */
    private get context(): OpenAICompatibleRuntimeContext {
      return {
        _options: this._options,
        baseURL: this.baseURL,
        client: this.client,
        getMappedModelId: (model) => this.getMappedModelId(model),
        getSignatureScope: (model, kind, protocol) => this.getSignatureScope(model, kind, protocol),
        handleError: (error) => this.handleError(error),
        id: this.id,
        instance: this,
        logPrefix: this.logPrefix,
        prepareResponsesRequest: (payload, logicalModel) =>
          this.prepareResponsesRequest(payload, logicalModel),
        resolvePromptCacheKeyParams: (model, user, existing) =>
          this.resolvePromptCacheKeyParams(model, user, existing),
        shouldUseResponsesAPI: (params) => this.shouldUseResponsesAPI(params),
        withMappedRequestModel: (payload, logicalModel) =>
          this.withMappedRequestModel(payload, logicalModel),
      };
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

    /**
     * `handlePayload` receives `this._options` and may retarget `baseURL` for a
     * specific model — Spark moves `spark-x2-flash` / `spark-x2` / `spark-x1.5`
     * to `/agent/v1`, `/x2` and `/v2`. Re-point the cached client at that URL
     * before the request, otherwise those models keep hitting the
     * constructor's `/v1`.
     */
    private syncClientWithPayloadBaseURL() {
      const computedBaseURL =
        typeof this._options.baseURL === 'string' && this._options.baseURL
          ? this._options.baseURL.trim()
          : typeof DEFAULT_BASE_URL === 'string'
            ? DEFAULT_BASE_URL
            : undefined;
      const targetBaseURL = computedBaseURL || this.baseURL;

      if (targetBaseURL === this.baseURL) return;

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
        this.client = new OpenAICompatibleClient(initOptions);
      }

      this.baseURL = targetBaseURL;
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
          return await chatViaResponses(
            this.context,
            factory,
            processedPayload,
            options,
            payload.model,
          );
        }

        // `handlePayload` may have retargeted the base URL for this model.
        this.syncClientWithPayloadBaseURL();

        return await chatViaChatCompletions(this.context, factory, {
          handledPayload,
          inputStartAt,
          log,
          options,
          payload,
          processedPayload,
          responseMode,
        });
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

    async createVideo(payload: CreateVideoPayload): Promise<CreateVideoResult> {
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
      return listOpenAICompatibleModels(this.context, factory);
    }

    async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
      return runGenerateObject(this.context, factory, payload, options);
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
      return createOpenAICompatibleSpeech(this.client, payload, options, {
        handleError: (error) => this.handleError(error),
        logPrefix: this.logPrefix,
        provider: this.id,
        requestModel: resolveMappedModelId(payload.model, this.modelIdMappingOptions),
      });
    }

    /**
     * Client used for `audio.transcriptions`. Providers whose transcription
     * endpoint differs from their chat base URL (e.g. Azure deployments) override it.
     */
    protected getTranscriptionClient(): OpenAI {
      return this.client;
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

        const transcription = await this.getTranscriptionClient().audio.transcriptions.create(
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

        if (options?.onUsage && typeof transcription !== 'string') {
          const pricing = await getModelPricing(payload.model, this.id, options.pricingContext);
          const usage = convertOpenAITranscriptionUsage((transcription as any).usage, pricing);
          if (usage) await options.onUsage(usage);
        }

        return { text };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    protected handleError(error: any): ChatCompletionErrorPayload {
      return mapOpenAICompatibleError(this.context, factory, error);
    }
  };
};
