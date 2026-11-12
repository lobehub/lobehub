import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import type { Stream } from '@anthropic-ai/sdk/streaming';
import { CURRENT_VERSION } from '@lobechat/const';
import type { ChatModelCard } from '@lobechat/types';
import debug from 'debug';
import type { Pricing } from 'model-bank';

import { ErrorClassifier } from '../../errors';
import type {
  ChatCompletionErrorPayload,
  ChatMethodOptions,
  ChatStreamCallbacks,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import type { ILobeAgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { desensitizeUrl } from '../../utils/desensitizeUrl';
import { getModelPricing } from '../../utils/getModelPricing';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { resolveMappedModelId } from '../../utils/modelIdMapping';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { ContextExceededPreFlightError } from '../../utils/resolveSafeMaxTokens';
import type { LobeRuntimeAI } from '../BaseAI';
import { chatViaMessages } from '../protocols/anthropicMessages/chat';
import { handleAnthropicError } from '../protocols/anthropicMessages/errors';
import {
  type AnthropicGenerateObjectConfig,
  createAnthropicGenerateObject,
} from '../protocols/anthropicMessages/generateObject';
import {
  buildDefaultAnthropicPayload,
  resolveDefaultAnthropicPricingOptions,
} from '../protocols/anthropicMessages/payload';
import { type ComputeChatCostOptions } from '../usageConverters/utils/computeChatCost';
import type { AnthropicCompatibleRuntimeContext } from './context';

export type ConstructorOptions<T extends Record<string, any> = any> = ClientOptions &
  ModelIdMappingOptions &
  T;

export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_CLIENT_TIMEOUT_ENV = 'ANTHROPIC_CLIENT_TIMEOUT';
/**
 * Keep Anthropic SDK's timeout explicit so non-streaming structured output
 * calls with large max_tokens do not hit the SDK's long-request guard before
 * the request is sent. The default stays below Vercel Hobby's 300s function
 * duration limit while provider/router options can still override it.
 */
export const DEFAULT_ANTHROPIC_TIMEOUT = 295_000;
const ANTHROPIC_SDK_MESSAGES_PATH_PATTERN = /\/v1(?:\/messages)?\/?$/;

const normalizeAnthropicCompatibleBaseURL = (baseURL?: string | null) =>
  baseURL?.replace(ANTHROPIC_SDK_MESSAGES_PATH_PATTERN, '');

const resolveDefaultAnthropicTimeout = () => {
  const timeout = Number(process.env[ANTHROPIC_CLIENT_TIMEOUT_ENV]);

  return Number.isInteger(timeout) && timeout > 0 ? timeout : DEFAULT_ANTHROPIC_TIMEOUT;
};

export {
  buildDefaultAnthropicPayload,
  resolveDefaultAnthropicPricingOptions,
} from '../protocols/anthropicMessages/payload';

export interface CustomClientOptions<T extends Record<string, any> = any> {
  createClient?: (options: ConstructorOptions<T>) => Anthropic;
}

export interface AnthropicCompatibleFactoryOptions<T extends Record<string, any> = any> {
  apiKey?: string;
  baseURL?: string;
  chatCompletion?: {
    /**
     * Build an Anthropic Messages API payload from ChatStreamPayload.
     * This is required because Anthropic-compatible providers have different
     * parameter constraints than OpenAI-compatible ones.
     */
    getPricingOptions?: (
      payload: ChatStreamPayload,
      anthropicPayload: Anthropic.MessageCreateParams,
    ) => Promise<ComputeChatCostOptions | undefined> | ComputeChatCostOptions | undefined;
    handleError?: (
      error: any,
      options: ConstructorOptions<T>,
    ) => Omit<ChatCompletionErrorPayload, 'provider'> | undefined;
    handlePayload?: (
      payload: ChatStreamPayload,
      options: ConstructorOptions<T>,
    ) => Promise<Anthropic.MessageCreateParams> | Anthropic.MessageCreateParams;
    handleStream?: (
      stream: Stream<Anthropic.MessageStreamEvent> | ReadableStream,
      {
        callbacks,
        inputStartAt,
        payload,
      }: { callbacks?: ChatStreamCallbacks; inputStartAt?: number; payload?: ChatStreamPayload },
    ) => ReadableStream;
  };
  constructorOptions?: ConstructorOptions<T>;
  customClient?: CustomClientOptions<T>;
  debug?: {
    chatCompletion?: () => boolean;
  };
  errorType?: {
    bizError: ILobeAgentRuntimeErrorType;
    invalidAPIKey: ILobeAgentRuntimeErrorType;
  };
  generateObject?: (
    client: Anthropic,
    payload: GenerateObjectPayload,
    options?: GenerateObjectOptions,
    pricing?: Pricing,
    config?: AnthropicGenerateObjectConfig,
  ) => Promise<any>;
  models?: (params: {
    apiKey?: string;
    baseURL: string;
    client: Anthropic;
  }) => Promise<ChatModelCard[]>;
  provider: string;
}

export interface AnthropicCompatibleParamsInput<T extends Record<string, any> = any> extends Omit<
  AnthropicCompatibleFactoryOptions<T>,
  'chatCompletion' | 'customClient' | 'generateObject' | 'models'
> {
  chatCompletion?: Partial<NonNullable<AnthropicCompatibleFactoryOptions<T>['chatCompletion']>>;
  customClient?: CustomClientOptions<T>;
  generateObject?: AnthropicCompatibleFactoryOptions<T>['generateObject'];
  models?: AnthropicCompatibleFactoryOptions<T>['models'];
}

/**
 * Create Anthropic SDK client with optional beta headers.
 */
export const createDefaultAnthropicClient = <T extends Record<string, any> = any>(
  options: ConstructorOptions<T>,
) => {
  const betaHeaders = process.env.ANTHROPIC_BETA_HEADERS;
  const baseURL = normalizeAnthropicCompatibleBaseURL(options.baseURL);
  const defaultHeaders = {
    'User-Agent': `lobehub/${CURRENT_VERSION}`,
    ...options.defaultHeaders,
    ...(betaHeaders ? { 'anthropic-beta': betaHeaders } : {}),
  };

  return new Anthropic({
    ...options,
    ...(baseURL ? { baseURL } : {}),
    defaultHeaders,
    timeout: options.timeout ?? resolveDefaultAnthropicTimeout(),
  });
};

/**
 * Default Anthropic error handler with desensitized endpoint.
 */
export const handleDefaultAnthropicError = <T extends Record<string, any> = any>(
  error: any,
  options: ConstructorOptions<T>,
  errorType?: AnthropicCompatibleFactoryOptions<T>['errorType'],
): Omit<ChatCompletionErrorPayload, 'provider'> => {
  const ErrorType = {
    bizError: errorType?.bizError || AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: errorType?.invalidAPIKey || AgentRuntimeErrorType.InvalidProviderAPIKey,
  };
  const baseURL =
    typeof options.baseURL === 'string' && options.baseURL
      ? options.baseURL
      : DEFAULT_ANTHROPIC_BASE_URL;
  const desensitizedEndpoint =
    baseURL !== DEFAULT_ANTHROPIC_BASE_URL ? desensitizeUrl(baseURL) : baseURL;

  if ('status' in (error as any)) {
    switch ((error as Response).status) {
      case 401: {
        return {
          endpoint: desensitizedEndpoint,
          error: error as any,
          errorType: ErrorType.invalidAPIKey,
        };
      }
      case 403: {
        return {
          endpoint: desensitizedEndpoint,
          error: error as any,
          errorType: AgentRuntimeErrorType.LocationNotSupportError,
        };
      }
      case 413: {
        return {
          endpoint: desensitizedEndpoint,
          error: error as any,
          errorType: AgentRuntimeErrorType.RequestBodyTooLarge,
        };
      }
      default: {
        break;
      }
    }
  }

  const { errorResult, message } = handleAnthropicError(error);

  const errorMsg = errorResult.message || errorResult.error?.message;

  if (ErrorClassifier.isAccountDeactivated(errorMsg)) {
    return {
      endpoint: desensitizedEndpoint,
      error: errorResult,
      errorType: AgentRuntimeErrorType.AccountDeactivated,
      message,
    };
  }

  if (ErrorClassifier.isInsufficientQuota(errorMsg)) {
    return {
      endpoint: desensitizedEndpoint,
      error: errorResult,
      errorType: AgentRuntimeErrorType.InsufficientQuota,
      message,
    };
  }

  if (ErrorClassifier.isExceededContextWindow(errorMsg)) {
    return {
      endpoint: desensitizedEndpoint,
      error: errorResult,
      errorType: AgentRuntimeErrorType.ExceededContextWindow,
      message,
    };
  }

  if (ErrorClassifier.isRateLimitExceeded(errorMsg)) {
    return {
      endpoint: desensitizedEndpoint,
      error: errorResult,
      errorType: AgentRuntimeErrorType.QuotaLimitReached,
      message,
    };
  }

  return {
    endpoint: desensitizedEndpoint,
    error: errorResult,
    errorType: ErrorType.bizError,
    message,
  };
};

/**
 * Default Anthropic models list fetcher.
 */
export const createDefaultAnthropicModels = async ({
  apiKey,
  baseURL,
}: {
  apiKey?: string;
  baseURL: string;
  client?: Anthropic;
}): Promise<ChatModelCard[]> => {
  if (!apiKey) {
    throw new Error('Missing Anthropic API key for model listing');
  }

  const response = await fetch(`${baseURL}/v1/models`, {
    headers: {
      'anthropic-version': '2023-06-01',
      'x-api-key': `${apiKey}`,
    },
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Anthropic models: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const modelList = (json['data'] || []) as Array<{
    created_at: string;
    display_name: string;
    id: string;
  }>;

  const standardModelList = modelList.map((model) => ({
    created: model.created_at,
    displayName: model.display_name,
    id: model.id,
  }));

  return processModelList(standardModelList, MODEL_LIST_CONFIGS.anthropic, 'anthropic');
};

/**
 * Build provider params by merging overrides with Anthropic defaults.
 */
export const createAnthropicCompatibleParams = <T extends Record<string, any> = any>(
  options: AnthropicCompatibleParamsInput<T>,
): AnthropicCompatibleFactoryOptions<T> => {
  const {
    baseURL = DEFAULT_ANTHROPIC_BASE_URL,
    chatCompletion,
    customClient,
    generateObject,
    models,
    ...rest
  } = options;

  return {
    ...rest,
    baseURL,
    chatCompletion: {
      getPricingOptions: resolveDefaultAnthropicPricingOptions,
      handlePayload: buildDefaultAnthropicPayload,
      ...chatCompletion,
    },
    customClient: customClient ?? { createClient: createDefaultAnthropicClient },
    generateObject: generateObject ?? createAnthropicGenerateObject,
    models: models ?? createDefaultAnthropicModels,
  } as AnthropicCompatibleFactoryOptions<T>;
};

export const createAnthropicCompatibleRuntime = <T extends Record<string, any> = any>(
  factory: AnthropicCompatibleFactoryOptions<T>,
) => {
  const {
    provider,
    baseURL: DEFAULT_BASE_URL = DEFAULT_ANTHROPIC_BASE_URL,
    apiKey: DEFAULT_API_KEY,
    errorType,
    constructorOptions,
    chatCompletion,
    customClient,
    models,
    generateObject,
  } = factory;
  const ErrorType = {
    bizError: errorType?.bizError || AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: errorType?.invalidAPIKey || AgentRuntimeErrorType.InvalidProviderAPIKey,
  };

  return class LobeAnthropicCompatibleAI implements LobeRuntimeAI {
    client!: Anthropic;

    private id: string;
    private logPrefix: string;
    private modelIdMappingOptions: ModelIdMappingOptions = {};

    baseURL!: string;
    protected _options: ConstructorOptions<T>;

    constructor(options: ClientOptions & Record<string, any> = {}) {
      const { modelIdMapping, ...inputOptions } = options as ClientOptions &
        Record<string, any> &
        ModelIdMappingOptions;
      const apiKey =
        typeof inputOptions.apiKey === 'string' ? inputOptions.apiKey.trim() : inputOptions.apiKey;
      const inputBaseURL =
        typeof inputOptions.baseURL === 'string'
          ? inputOptions.baseURL.trim()
          : inputOptions.baseURL;
      // Anthropic SDK appends `/v1/messages`; normalize gateway URLs that already
      // include that SDK-managed path segment before constructing any client.
      const baseURL = normalizeAnthropicCompatibleBaseURL(inputBaseURL);
      const defaultBaseURL = normalizeAnthropicCompatibleBaseURL(DEFAULT_BASE_URL);

      const resolvedOptions = {
        ...inputOptions,
        apiKey: apiKey || DEFAULT_API_KEY,
        baseURL: baseURL || defaultBaseURL,
      };
      const {
        apiKey: finalApiKey,
        baseURL: finalBaseURL = DEFAULT_BASE_URL,
        ...rest
      } = resolvedOptions;
      this._options = resolvedOptions as ConstructorOptions<T>;
      this.modelIdMappingOptions = { modelIdMapping };

      if (!finalApiKey) throw AgentRuntimeError.createError(ErrorType.invalidAPIKey);

      const initOptions = {
        apiKey: finalApiKey,
        baseURL: finalBaseURL,
        ...constructorOptions,
        ...rest,
        timeout: rest.timeout ?? constructorOptions?.timeout ?? resolveDefaultAnthropicTimeout(),
      };

      if (customClient?.createClient) {
        this.client = customClient.createClient(initOptions as ConstructorOptions<T>);
      } else {
        this.client = new Anthropic(initOptions as ConstructorOptions<T>);
      }

      this.baseURL = finalBaseURL || this.client.baseURL;
      this.id = options.id || provider;
      this.logPrefix = `lobe-model-runtime:${this.id}`;
    }

    private withMappedRequestModel<TPayload extends { model?: string }>(
      requestPayload: TPayload,
      logicalModel: string,
    ): TPayload {
      if (!requestPayload.model) return requestPayload;

      const mappedModel = resolveMappedModelId(logicalModel, this.modelIdMappingOptions);
      if (requestPayload.model !== logicalModel || mappedModel === requestPayload.model) {
        return requestPayload;
      }

      return { ...requestPayload, model: mappedModel };
    }

    /** What the protocol modules read; built per call so it always reflects current state. */
    private get context(): AnthropicCompatibleRuntimeContext {
      return {
        _options: this._options,
        baseURL: this.baseURL,
        client: this.client,
        id: this.id,
        logPrefix: this.logPrefix,
        withMappedRequestModel: (payload, logicalModel) =>
          this.withMappedRequestModel(payload, logicalModel),
      };
    }

    async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
      try {
        return await chatViaMessages(this.context, factory, payload, options);
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
      if (!generateObject) {
        throw new Error('GenerateObject is not supported by this provider');
      }

      try {
        const pricing = await getModelPricing(payload.model, this.id, options?.pricingContext);
        return await generateObject(this.client, payload, options, pricing, {
          requestModel: resolveMappedModelId(payload.model, this.modelIdMappingOptions),
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async models() {
      if (!models) return [];
      return models({
        apiKey: (this._options.apiKey as string) ?? undefined,
        baseURL: this.baseURL,
        client: this.client,
      });
    }

    protected handleError(error: any): ChatCompletionErrorPayload {
      const log = debug(`${this.logPrefix}:error`);
      log('handling error: %O', error);

      let desensitizedEndpoint = this.baseURL;
      if (this.baseURL !== DEFAULT_BASE_URL) {
        desensitizedEndpoint = desensitizeUrl(this.baseURL);
      }

      if (error instanceof ContextExceededPreFlightError) {
        return AgentRuntimeError.chat({
          endpoint: desensitizedEndpoint,
          error: error.toPayload(),
          errorType: AgentRuntimeErrorType.ExceededContextWindow,
          message: error.message,
          provider: this.id,
        });
      }

      if (chatCompletion?.handleError) {
        const errorResult = chatCompletion.handleError(error, this._options);
        if (errorResult)
          return AgentRuntimeError.chat({
            ...errorResult,
            provider: this.id,
          } as ChatCompletionErrorPayload);
      }

      const errorResult = handleDefaultAnthropicError(error, this._options, errorType);
      return AgentRuntimeError.chat({
        ...errorResult,
        provider: this.id,
      } as ChatCompletionErrorPayload);
    }
  };
};
