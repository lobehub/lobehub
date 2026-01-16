/**
 * @see https://github.com/lobehub/lobe-chat/discussions/6563
 */
import type { ChatModelCard } from '@lobechat/types';
import OpenAI, { ClientOptions } from 'openai';
import { Stream } from 'openai/streaming';

import { LobeOpenAI } from '../../providers/openai';
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
import { LobeRuntimeAI } from '../BaseAI';
import { CreateImageOptions, CustomClientOptions } from '../openaiCompatibleFactory';
import { baseRuntimeMap } from './baseRuntimeMap';

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
  apiType?: keyof typeof baseRuntimeMap;
}

type RouterOptions = RouterOptionItem | RouterOptionItem[];

export type RuntimeClass = typeof LobeOpenAI;

interface RouterInstance {
  apiType: keyof typeof baseRuntimeMap;
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
      return (
        resolvedRouters.find((router) => {
          if (router.models && router.models.length > 0) {
            return router.models.includes(model);
          }
          return false;
        }) ?? resolvedRouters.at(-1)!
      );
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
    private createRuntimeFromOption(
      router: RouterInstance,
      optionItem: RouterOptionItem,
    ): { id: keyof typeof baseRuntimeMap; runtime: LobeRuntimeAI } {
      const { apiType: optionApiType, ...optionOverrides } = optionItem;
      const resolvedApiType = optionApiType ?? router.apiType;
      const providerAI =
        resolvedApiType === router.apiType
          ? (router.runtime ?? baseRuntimeMap[resolvedApiType] ?? LobeOpenAI)
          : (baseRuntimeMap[resolvedApiType] ?? LobeOpenAI);
      const finalOptions = { ...this._params, ...this._options, ...optionOverrides };
      const runtime: LobeRuntimeAI = new providerAI({ ...finalOptions, id: this._id });

      return {
        id: resolvedApiType,
        runtime,
      };
    }

    private async runWithFallback<T>(
      model: string,
      requestHandler: (runtime: LobeRuntimeAI) => Promise<T>,
    ): Promise<T> {
      const matchedRouter = await this.resolveMatchedRouter(model);
      const routerOptions = this.normalizeRouterOptions(matchedRouter);

      let lastError: unknown;

      for (const optionItem of routerOptions) {
        const { runtime } = this.createRuntimeFromOption(matchedRouter, optionItem);

        try {
          return await requestHandler(runtime);
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError ?? new Error('empty provider options');
    }

    async models() {
      const resolvedRouters = await this.resolveRouters();
      const runtimes = resolvedRouters.map((router) => {
        const routerOptions = this.normalizeRouterOptions(router);
        const { id: resolvedApiType, runtime } = this.createRuntimeFromOption(
          router,
          routerOptions[0],
        );

        return {
          id: resolvedApiType,
          models: router.models,
          runtime,
        };
      });

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
