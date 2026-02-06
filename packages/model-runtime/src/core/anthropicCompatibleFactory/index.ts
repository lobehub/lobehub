import Anthropic, { ClientOptions } from '@anthropic-ai/sdk';
import type { Stream } from '@anthropic-ai/sdk/streaming';
import type { ChatModelCard } from '@lobechat/types';
import debug from 'debug';

import { hasTemperatureTopPConflict } from '../../const/models';
import {
  ChatCompletionErrorPayload,
  ChatMethodOptions,
  ChatStreamCallbacks,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { AgentRuntimeErrorType, ILobeAgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { debugStream } from '../../utils/debugStream';
import { desensitizeUrl } from '../../utils/desensitizeUrl';
import { getModelPricing } from '../../utils/getModelPricing';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { StreamingResponse } from '../../utils/response';
import { LobeRuntimeAI } from '../BaseAI';
import {
  buildAnthropicMessages,
  buildAnthropicTools,
  buildSearchTool,
} from '../contextBuilders/anthropic';
import { resolveParameters } from '../parameterResolver';
import { AnthropicStream } from '../streams';
import type { ComputeChatCostOptions } from '../usageConverters/utils/computeChatCost';
import { createAnthropicGenerateObject } from './generateObject';
import { handleAnthropicError } from './handleAnthropicError';
import { resolveCacheTTL } from './resolveCacheTTL';
import { resolveMaxTokens } from './resolveMaxTokens';

type ConstructorOptions<T extends Record<string, any> = any> = ClientOptions & T;

type AnthropicTools = Anthropic.Tool | Anthropic.WebSearchTool20250305;

export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

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
 * Build the default Anthropic Messages payload with LobeChat normalization.
 */
export const buildDefaultAnthropicPayload = async (
  payload: ChatStreamPayload,
): Promise<Anthropic.MessageCreateParams> => {
  const {
    messages,
    model,
    max_tokens,
    temperature,
    top_p,
    tools,
    thinking,
    effort,
    enabledContextCaching = true,
    enabledSearch,
  } = payload;

  const { anthropic: anthropicModels } = await import('model-bank');

  const resolvedMaxTokens = await resolveMaxTokens({
    max_tokens,
    model,
    providerModels: anthropicModels,
    thinking,
  });

  const systemMessage = messages.find((message) => message.role === 'system');
  const userMessages = messages.filter((message) => message.role !== 'system');

  const systemPrompts = systemMessage?.content
    ? ([
        {
          cache_control: enabledContextCaching ? { type: 'ephemeral' } : undefined,
          text: systemMessage.content as string,
          type: 'text',
        },
      ] as Anthropic.TextBlockParam[])
    : undefined;

  const postMessages = await buildAnthropicMessages(userMessages, { enabledContextCaching });

  // Claude Opus 4.6 does not support assistant turn prefill
  if (model.includes('opus-4-6') && postMessages.at(-1)?.role === 'assistant') {
    postMessages.pop();
  }

  let postTools = buildAnthropicTools(tools, { enabledContextCaching }) as
    | AnthropicTools[]
    | undefined;

  if (enabledSearch) {
    const webSearchTool = buildSearchTool();
    postTools = postTools?.length ? [...postTools, webSearchTool] : [webSearchTool];
  }

  if (!!thinking && (thinking.type === 'enabled' || thinking.type === 'adaptive')) {
    const resolvedThinking: Anthropic.MessageCreateParams['thinking'] =
      thinking.type === 'enabled'
        ? {
            budget_tokens: Math.min(
              thinking?.budget_tokens || 1024,
              resolvedMaxTokens - 1,
            ),
            type: 'enabled',
          }
        : { type: 'adaptive' };

    return {
      max_tokens: resolvedMaxTokens,
      messages: postMessages,
      model,
      system: systemPrompts,
      ...(thinking.type === 'adaptive' && effort ? { output_config: { effort } } : {}),
      thinking: resolvedThinking,
      tools: postTools as Anthropic.MessageCreateParams['tools'],
    } as Anthropic.MessageCreateParams;
  }

  const hasConflict = hasTemperatureTopPConflict(model);
  const resolvedParams = resolveParameters(
    { temperature, top_p },
    { hasConflict, normalizeTemperature: true, preferTemperature: true },
  );

  return {
    max_tokens: resolvedMaxTokens,
    messages: postMessages,
    model,
    system: systemPrompts,
    temperature: resolvedParams.temperature,
    tools: postTools as Anthropic.MessageCreateParams['tools'],
    top_p: resolvedParams.top_p,
  } satisfies Anthropic.MessageCreateParams;
};

/**
 * Resolve cache-aware pricing options for usage cost calculation.
 */
export const resolveDefaultAnthropicPricingOptions = (
  requestPayload: ChatStreamPayload,
  anthropicPayload: Anthropic.MessageCreateParams,
): ComputeChatCostOptions | undefined => {
  const cacheTTL = resolveCacheTTL(requestPayload, {
    messages: anthropicPayload.messages,
    system: anthropicPayload.system,
  });

  if (!cacheTTL) return undefined;

  return { lookupParams: { ttl: cacheTTL } };
};

/**
 * Create Anthropic SDK client with optional beta headers.
 */
export const createDefaultAnthropicClient = <T extends Record<string, any> = any>(
  options: ConstructorOptions<T>,
) => {
  const betaHeaders = process.env.ANTHROPIC_BETA_HEADERS;
  const defaultHeaders = {
    ...options.defaultHeaders,
    ...(betaHeaders ? { 'anthropic-beta': betaHeaders } : {}),
  };

  return new Anthropic({ ...options, defaultHeaders });
};

/**
 * Default Anthropic error handler with desensitized endpoint.
 */
export const handleDefaultAnthropicError = <T extends Record<string, any> = any>(
  error: any,
  options: ConstructorOptions<T>,
): Omit<ChatCompletionErrorPayload, 'provider'> => {
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
          errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        };
      }
      case 403: {
        return {
          endpoint: desensitizedEndpoint,
          error: error as any,
          errorType: AgentRuntimeErrorType.LocationNotSupportError,
        };
      }
      default: {
        break;
      }
    }
  }

  const { errorResult } = handleAnthropicError(error);

  return {
    endpoint: desensitizedEndpoint,
    error: errorResult,
    errorType: AgentRuntimeErrorType.ProviderBizError,
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
      handleError: handleDefaultAnthropicError,
      handlePayload: buildDefaultAnthropicPayload,
      ...chatCompletion,
    },
    customClient: customClient ?? { createClient: createDefaultAnthropicClient },
    generateObject: generateObject ?? createAnthropicGenerateObject,
    models: models ?? createDefaultAnthropicModels,
  } as AnthropicCompatibleFactoryOptions<T>;
};

export const createAnthropicCompatibleRuntime = <T extends Record<string, any> = any>({
  provider,
  baseURL: DEFAULT_BASE_URL = DEFAULT_ANTHROPIC_BASE_URL,
  apiKey: DEFAULT_API_KEY,
  errorType,
  debug: debugParams,
  constructorOptions,
  chatCompletion,
  customClient,
  models,
  generateObject,
}: AnthropicCompatibleFactoryOptions<T>) => {
  const ErrorType = {
    bizError: errorType?.bizError || AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: errorType?.invalidAPIKey || AgentRuntimeErrorType.InvalidProviderAPIKey,
  };

  return class LobeAnthropicCompatibleAI implements LobeRuntimeAI {
    client!: Anthropic;

    private id: string;
    private logPrefix: string;

    baseURL!: string;
    protected _options: ConstructorOptions<T>;

    constructor(options: ClientOptions & Record<string, any> = {}) {
      const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : options.apiKey;
      const baseURL =
        typeof options.baseURL === 'string' ? options.baseURL.trim() : options.baseURL;

      const resolvedOptions = {
        ...options,
        apiKey: apiKey || DEFAULT_API_KEY,
        baseURL: baseURL || DEFAULT_BASE_URL,
      };
      const {
        apiKey: finalApiKey,
        baseURL: finalBaseURL = DEFAULT_BASE_URL,
        ...rest
      } = resolvedOptions;
      this._options = resolvedOptions as ConstructorOptions<T>;

      if (!finalApiKey) throw AgentRuntimeError.createError(ErrorType.invalidAPIKey);

      const initOptions = {
        apiKey: finalApiKey,
        baseURL: finalBaseURL,
        ...constructorOptions,
        ...rest,
      };

      if (customClient?.createClient) {
        this.client = customClient.createClient(initOptions as ConstructorOptions<T>);
      } else {
        this.client = new Anthropic(initOptions as ConstructorOptions<T>);
      }

      this.baseURL = baseURL || this.client.baseURL;
      this.id = options.id || provider;
      this.logPrefix = `lobe-model-runtime:${this.id}`;
    }

    async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
      try {
        if (!chatCompletion?.handlePayload) {
          throw new Error('Anthropic-compatible runtime requires chatCompletion.handlePayload');
        }

        const log = debug(`${this.logPrefix}:chat`);
        const inputStartAt = Date.now();

        log('chat called with model: %s, stream: %s', payload.model, payload.stream ?? true);

        const postPayload = await chatCompletion.handlePayload(payload, this._options);
        const shouldStream = postPayload.stream ?? payload.stream ?? true;
        const finalPayload = { ...postPayload, stream: shouldStream };

        if (debugParams?.chatCompletion?.()) {
          console.log('[requestPayload]');
          console.log(JSON.stringify(finalPayload), '\n');
        }

        const response = await this.client.messages.create(
          {
            ...finalPayload,
            metadata: options?.user ? { user_id: options.user } : undefined,
          },
          {
            headers: options?.requestHeaders,
            signal: options?.signal,
          },
        );

        const pricing = await getModelPricing(payload.model, this.id);
        const pricingOptions = await chatCompletion?.getPricingOptions?.(payload, postPayload);
        const streamOptions = {
          callbacks: options?.callback,
          payload: {
            model: payload.model,
            pricing,
            pricingOptions,
            provider: this.id,
          },
        };

        if (shouldStream) {
          const streamResponse = response as Stream<Anthropic.MessageStreamEvent>;
          const [prod, useForDebug] = streamResponse.tee();

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
                  payload,
                })
              : AnthropicStream(prod, { ...streamOptions, inputStartAt }),
            {
              headers: options?.headers,
            },
          );
        }

        if (payload.responseMode === 'json') {
          return Response.json(response);
        }

        const stream = new ReadableStream<Anthropic.MessageStreamEvent>({
          start(controller) {
            const message = response as Anthropic.Message;

            controller.enqueue({
              message,
              type: 'message_start',
            } satisfies Anthropic.MessageStreamEvent);

            message.content?.forEach((block, index) => {
              if (block.type === 'tool_use' || block.type === 'server_tool_use') {
                controller.enqueue({
                  content_block: block,
                  index,
                  type: 'content_block_start',
                } satisfies Anthropic.MessageStreamEvent);

                controller.enqueue({
                  delta: {
                    partial_json: JSON.stringify(block.input ?? {}),
                    type: 'input_json_delta',
                  },
                  index,
                  type: 'content_block_delta',
                } satisfies Anthropic.MessageStreamEvent);
              }

              if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                controller.enqueue({
                  content_block: block,
                  index,
                  type: 'content_block_start',
                } satisfies Anthropic.MessageStreamEvent);
              }

              if (block.type === 'text') {
                controller.enqueue({
                  delta: { text: block.text, type: 'text_delta' },
                  index,
                  type: 'content_block_delta',
                } satisfies Anthropic.MessageStreamEvent);
              }
            });

            controller.enqueue({
              delta: {
                stop_reason: message.stop_reason,
                stop_sequence: message.stop_sequence ?? null,
              },
              type: 'message_delta',
              usage: {
                cache_creation_input_tokens: message.usage?.cache_creation_input_tokens ?? null,
                cache_read_input_tokens: message.usage?.cache_read_input_tokens ?? null,
                input_tokens: message.usage?.input_tokens ?? null,
                output_tokens: 0,
                server_tool_use: message.usage?.server_tool_use ?? null,
              },
            } satisfies Anthropic.MessageStreamEvent);

            controller.enqueue({ type: 'message_stop' } satisfies Anthropic.MessageStreamEvent);
            controller.close();
          },
        });

        return StreamingResponse(
          chatCompletion?.handleStream
            ? chatCompletion.handleStream(stream, {
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
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
      if (!generateObject) {
        throw new Error('GenerateObject is not supported by this provider');
      }

      try {
        return await generateObject(this.client, payload, options);
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

      if (chatCompletion?.handleError) {
        const errorResult = chatCompletion.handleError(error, this._options);
        if (errorResult)
          return AgentRuntimeError.chat({
            ...errorResult,
            provider: this.id,
          } as ChatCompletionErrorPayload);
      }

      if ('status' in (error as any)) {
        switch ((error as Response).status) {
          case 401: {
            return AgentRuntimeError.chat({
              endpoint: desensitizedEndpoint,
              error: error as any,
              errorType: ErrorType.invalidAPIKey,
              provider: this.id,
            });
          }
          case 403: {
            return AgentRuntimeError.chat({
              endpoint: desensitizedEndpoint,
              error: error as any,
              errorType: AgentRuntimeErrorType.LocationNotSupportError,
              provider: this.id,
            });
          }
          default: {
            break;
          }
        }
      }

      const errorResult = (() => {
        if (error?.error) {
          const innerError = error.error;
          if ('error' in innerError) {
            return innerError.error;
          }
          return innerError;
        }

        return { headers: error?.headers, stack: error?.stack, status: error?.status };
      })();

      return AgentRuntimeError.chat({
        endpoint: desensitizedEndpoint,
        error: errorResult,
        errorType: ErrorType.bizError,
        provider: this.id,
      });
    }
  };
};
