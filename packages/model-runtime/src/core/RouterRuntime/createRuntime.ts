/**
 * @see https://github.com/lobehub/lobe-chat/discussions/6563
 */
import type { GoogleGenAIOptions } from '@google/genai';
import type { ChatModelCard } from '@lobechat/types';
import debug from 'debug';
import OpenAI, { ClientOptions } from 'openai';
import { Stream } from 'openai/streaming';

import { LobeOpenAI } from '../../providers/openai';
import { LobeVertexAI } from '../../providers/vertexai';
import {
  CreateImagePayload,
  CreateImageResponse,
  GenerateObjectOptions,
  GenerateObjectPayload,
  ILobeAgentRuntimeErrorType,
} from '../../types';
import {
  type ChatCompletionErrorPayload,
  ChatMethodOptions,
  ChatStreamCallbacks,
  ChatStreamPayload,
  EmbeddingsOptions,
  EmbeddingsPayload,
  TextToSpeechPayload,
} from '../../types';
import { postProcessModelList } from '../../utils/postProcessModelList';
import { safeParseJSON } from '../../utils/safeParseJSON';
import { LobeRuntimeAI } from '../BaseAI';
import { CreateImageOptions, CustomClientOptions } from '../openaiCompatibleFactory';
import type { ApiType, RuntimeClass } from './apiTypes';

const log = debug('lobe-model-runtime:router-runtime');

interface ProviderIniOptions extends Record<string, any> {
  accessKeyId?: string;
  accessKeySecret?: string;
  apiKey?: string;
  apiVersion?: string;
  baseURL?: string;
  baseURLOrAccountID?: string;
  dangerouslyAllowBrowser?: boolean;
  region?: string;
  sessionToken?: string;
}

/**
 * Router option item used for inference.
 * When `options` is an array, items are tried in order for chat fallback.
 * `apiType` allows switching provider when falling back.
 */
interface RouterOptionItem extends ProviderIniOptions {
  apiType?: ApiType;
  id?: string;
  remark?: string;
}

type RouterOptions = RouterOptionItem | RouterOptionItem[];

interface RouterInstance {
  apiType: ApiType;
  baseURLPattern?: RegExp;
  id?: string;
  models?: string[];
  options: RouterOptions;
  runtime?: RuntimeClass;
}

type ConstructorOptions<T extends Record<string, any> = any> = ClientOptions & T;

type Routers =
  | RouterInstance[]
  | ((
      options: ClientOptions & Record<string, any>,
      runtimeContext: {
        model?: string;
      },
    ) => RouterInstance[] | Promise<RouterInstance[]>);

export interface RouteAttemptResult {
  apiType: string;
  channelId?: string;
  durationMs: number;
  error?: unknown;
  model: string;
  providerId: string;
  remark?: string;
  routerId?: string;
  success: boolean;
}

export interface CreateRouterRuntimeOptions<T extends Record<string, any> = any> {
  apiKey?: string;
  chatCompletion?: {
    excludeUsage?: boolean;
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
      { callbacks, inputStartAt }: { callbacks?: ChatStreamCallbacks; inputStartAt?: number },
    ) => ReadableStream;
    handleStreamBizErrorType?: (error: {
      message: string;
      name: string;
    }) => ILobeAgentRuntimeErrorType | undefined;
    handleTransformResponseToStream?: (
      data: OpenAI.ChatCompletion,
    ) => ReadableStream<OpenAI.ChatCompletionChunk>;
    noUserId?: boolean;
  };
  constructorOptions?: ConstructorOptions<T>;
  createImage?: (
    payload: CreateImagePayload,
    options: CreateImageOptions,
  ) => Promise<CreateImageResponse>;
  customClient?: CustomClientOptions<T>;
  debug?: {
    chatCompletion: () => boolean;
    responses?: () => boolean;
  };
  defaultHeaders?: Record<string, any>;
  errorType?: {
    bizError: ILobeAgentRuntimeErrorType;
    invalidAPIKey: ILobeAgentRuntimeErrorType;
  };
  id: string;
  models?:
    | ((params: { client: OpenAI }) => Promise<ChatModelCard[]>)
    | {
        transformModel?: (model: OpenAI.Model) => ChatModelCard;
      };
  onRouteAttempt?: (result: RouteAttemptResult) => Promise<void>;
  responses?: {
    handlePayload?: (
      payload: ChatStreamPayload,
      options: ConstructorOptions<T>,
    ) => ChatStreamPayload;
  };
  routers: Routers;
}

export const createRouterRuntime = ({
  id,
  routers,
  apiKey: DEFAULT_API_KEY,
  models: modelsOption,
  ...params
}: CreateRouterRuntimeOptions) => {
  return class UniformRuntime implements LobeRuntimeAI {
    public _options: ClientOptions & Record<string, any>;
    private _routers: Routers;
    private _params: any;
    private _id: string;

    constructor(options: ClientOptions & Record<string, any> = {}) {
      this._options = {
        ...options,
        apiKey: options.apiKey?.trim() || DEFAULT_API_KEY,
        baseURL: options.baseURL?.trim(),
      };

      // Save configuration without creating runtimes
      this._routers = routers;
      this._params = params;
      this._id = id;
    }

    /**
     * Resolve routers configuration and validate
     */
    private async resolveRouters(model?: string): Promise<RouterInstance[]> {
      const resolvedRouters =
        typeof this._routers === 'function'
          ? await this._routers(this._options, { model })
          : this._routers;

      if (resolvedRouters.length === 0) {
        throw new Error('empty providers');
      }

      return resolvedRouters;
    }

    private async resolveMatchedRouter(model: string): Promise<RouterInstance> {
      const resolvedRouters = await this.resolveRouters(model);
      const baseURL = this._options.baseURL;

      // Priority 1: Match by baseURLPattern (RegExp only)
      if (baseURL) {
        const baseURLMatch = resolvedRouters.find((router) => router.baseURLPattern?.test(baseURL));
        if (baseURLMatch) return baseURLMatch;
      }

      // Priority 2: Match by models
      const modelMatch = resolvedRouters.find((router) => {
        if (router.models && router.models.length > 0) {
          return router.models.includes(model);
        }
        return false;
      });
      if (modelMatch) return modelMatch;

      // Fallback: Use the last router
      return resolvedRouters.at(-1)!;
    }

    private normalizeRouterOptions(router: RouterInstance): RouterOptionItem[] {
      const routerOptions = Array.isArray(router.options) ? router.options : [router.options];

      if (routerOptions.length === 0 || routerOptions.some((optionItem) => !optionItem)) {
        throw new Error('empty provider options');
      }

      return routerOptions;
    }

    /**
     * Build a runtime instance for a specific option item.
     * Option items can override apiType to switch providers for fallback.
     */
    private async createRuntimeFromOption(
      router: RouterInstance,
      optionItem: RouterOptionItem,
    ): Promise<{
      channelId?: string;
      id: ApiType;
      remark?: string;
      runtime: LobeRuntimeAI;
    }> {
      const { apiType: optionApiType, id: channelId, remark, ...optionOverrides } = optionItem;
      const resolvedApiType = optionApiType ?? router.apiType;
      const finalOptions = { ...this._params, ...this._options, ...optionOverrides };

      /**
       * Vertex AI uses GoogleGenAI credentials flow rather than API keys.
       * Accept JSON credentials in apiKey for compatibility with server config.
       */
      if (resolvedApiType === 'vertexai') {
        const { apiKey, googleAuthOptions, project, location, ...restOptions } = finalOptions;
        const credentials = safeParseJSON<Record<string, any>>(apiKey);
        const vertexOptions: GoogleGenAIOptions = {
          ...(restOptions as GoogleGenAIOptions),
          vertexai: true,
        };

        if (googleAuthOptions) {
          vertexOptions.googleAuthOptions = googleAuthOptions;
        } else if (credentials) {
          vertexOptions.googleAuthOptions = { credentials };
        }

        if (project) vertexOptions.project = project;
        if (location) vertexOptions.location = location as GoogleGenAIOptions['location'];

        return {
          channelId,
          id: resolvedApiType,
          remark,
          runtime: LobeVertexAI.initFromVertexAI(vertexOptions),
        };
      }

      const { baseRuntimeMap } = await import('./baseRuntimeMap');
      const providerAI =
        resolvedApiType === router.apiType
          ? (router.runtime ?? baseRuntimeMap[resolvedApiType] ?? LobeOpenAI)
          : (baseRuntimeMap[resolvedApiType] ?? LobeOpenAI);
      const runtime: LobeRuntimeAI = new providerAI({ ...finalOptions, id: this._id });

      return {
        channelId,
        id: resolvedApiType,
        remark,
        runtime,
      };
    }

    private async runWithFallback<T>(
      model: string,
      requestHandler: (runtime: LobeRuntimeAI) => Promise<T>,
    ): Promise<T> {
      const matchedRouter = await this.resolveMatchedRouter(model);
      const routerOptions = this.normalizeRouterOptions(matchedRouter);
      const totalOptions = routerOptions.length;

      log(
        'resolve router for model=%s apiType=%s options=%d',
        model,
        matchedRouter.apiType,
        totalOptions,
      );

      let lastError: unknown;

      for (const [index, optionItem] of routerOptions.entries()) {
        const attempt = index + 1;
        const startTime = Date.now();
        const {
          channelId,
          id: resolvedApiType,
          remark,
          runtime,
        } = await this.createRuntimeFromOption(matchedRouter, optionItem);

        try {
          const result = await requestHandler(runtime);

          if (totalOptions > 1 && attempt > 1) {
            log(
              'fallback success for model=%s attempt=%d/%d apiType=%s channelId=%s remark=%s',
              model,
              attempt,
              totalOptions,
              resolvedApiType,
              channelId ?? '',
              remark ?? '',
            );
          }

          params.onRouteAttempt?.({
            apiType: resolvedApiType,
            channelId,
            durationMs: Date.now() - startTime,
            model,
            providerId: id,
            remark,
            routerId: matchedRouter.id,
            success: true,
          }).catch((e) => {
            log('onRouteAttempt callback error: %O', e);
          });

          return result;
        } catch (error) {
          lastError = error;

          params.onRouteAttempt?.({
            apiType: resolvedApiType,
            channelId,
            durationMs: Date.now() - startTime,
            error,
            model,
            providerId: id,
            remark,
            routerId: matchedRouter.id,
            success: false,
          }).catch((e) => {
            log('onRouteAttempt callback error: %O', e);
          });

          if (attempt < totalOptions) {
            log(
              'attempt %d/%d failed (model=%s apiType=%s channelId=%s remark=%s), trying next',
              attempt,
              totalOptions,
              model,
              resolvedApiType,
              channelId ?? '',
              remark ?? '',
            );
          } else {
            log(
              'attempt %d/%d failed (model=%s apiType=%s channelId=%s remark=%s), no more fallbacks',
              attempt,
              totalOptions,
              model,
              resolvedApiType,
              channelId ?? '',
              remark ?? '',
            );
          }
          console.error(error);
        }
      }

      throw lastError ?? new Error('empty provider options');
    }

    async models() {
      const resolvedRouters = await this.resolveRouters();
      const runtimes = await Promise.all(
        resolvedRouters.map(async (router) => {
          const routerOptions = this.normalizeRouterOptions(router);
          const { id: resolvedApiType, runtime } = await this.createRuntimeFromOption(
            router,
            routerOptions[0],
          );

          return {
            id: resolvedApiType,
            models: router.models,
            runtime,
          };
        }),
      );

      if (modelsOption && typeof modelsOption === 'function') {
        // If it's a functional configuration, use the last runtime's client to call the function
        const lastRuntime = runtimes.at(-1)?.runtime;
        if (lastRuntime && 'client' in lastRuntime) {
          const modelList = await modelsOption({ client: (lastRuntime as any).client });
          return await postProcessModelList(modelList);
        }
      }

      return runtimes.at(-1)?.runtime.models?.();
    }

    /**
     * Try router options in order for chat requests.
     * When options is an array, fall back to the next item on failure.
     */
    async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
      try {
        return await this.runWithFallback(payload.model, (runtime) =>
          runtime.chat!(payload, options),
        );
      } catch (e) {
        if (params.chatCompletion?.handleError) {
          const error = params.chatCompletion.handleError(e, this._options);

          if (error) {
            throw error;
          }
        }

        throw e;
      }
    }

    async createImage(payload: CreateImagePayload) {
      return this.runWithFallback(payload.model, (runtime) => runtime.createImage!(payload));
    }

    async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
      return this.runWithFallback(payload.model, (runtime) =>
        runtime.generateObject!(payload, options),
      );
    }

    async embeddings(payload: EmbeddingsPayload, options?: EmbeddingsOptions) {
      return this.runWithFallback(payload.model, (runtime) =>
        runtime.embeddings!(payload, options),
      );
    }

    async textToSpeech(payload: TextToSpeechPayload, options?: EmbeddingsOptions) {
      return this.runWithFallback(payload.model, (runtime) =>
        runtime.textToSpeech!(payload, options),
      );
    }
  };
};

export type UniformRuntime = InstanceType<ReturnType<typeof createRouterRuntime>>;
