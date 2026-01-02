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
  TextToImagePayload,
  TextToSpeechPayload,
} from '../../types';
import { postProcessModelList } from '../../utils/postProcessModelList';
import { LobeRuntimeAI } from '../BaseAI';
import { CreateImageOptions, CustomClientOptions } from '../openaiCompatibleFactory';
import { baseRuntimeMap } from './baseRuntimeMap';

export interface RuntimeItem {
  id: string;
  models?: string[];
  runtime: LobeRuntimeAI;
}

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

export type RuntimeClass = typeof LobeOpenAI;

interface RouterInstance {
  apiType: keyof typeof baseRuntimeMap;
  models?: string[];
  options: ProviderIniOptions;
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

    /**
     * Create runtime for inference requests (chat, generateObject, etc.)
     * Finds the router that matches the model, or uses the last router as fallback
     */
    private async createRuntimeForInference(model: string): Promise<RuntimeItem> {
      const resolvedRouters = await this.resolveRouters(model);

      const matchedRouter =
        resolvedRouters.find((router) => {
          if (router.models && router.models.length > 0) {
            return router.models.includes(model);
          }
          return false;
        }) ?? resolvedRouters.at(-1)!;

      const providerAI =
        matchedRouter.runtime ?? baseRuntimeMap[matchedRouter.apiType] ?? LobeOpenAI;
      const finalOptions = { ...this._params, ...this._options, ...matchedRouter.options };
      const runtime: LobeRuntimeAI = new providerAI({ ...finalOptions, id: this._id });

      return {
        id: matchedRouter.apiType,
        models: matchedRouter.models,
        runtime,
      };
    }

    /**
     * Create all runtimes for listing models
     */
    private async createRuntimes(): Promise<RuntimeItem[]> {
      const resolvedRouters = await this.resolveRouters();
      return resolvedRouters.map((router) => {
        const providerAI = router.runtime ?? baseRuntimeMap[router.apiType] ?? LobeOpenAI;
        const finalOptions = { ...this._params, ...this._options, ...router.options };
        const runtime: LobeRuntimeAI = new providerAI({ ...finalOptions, id: this._id });

        return {
          id: router.apiType,
          models: router.models,
          runtime,
        };
      });
    }

    // Check if it can match a specific model, otherwise default to using the last runtime
    async getRuntimeByModel(model: string) {
      const runtimeItem = await this.createRuntimeForInference(model);
      return runtimeItem.runtime;
    }

    async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
      try {
        const runtime = await this.getRuntimeByModel(payload.model);
        return await runtime.chat!(payload, options);
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

    async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
      const runtime = await this.getRuntimeByModel(payload.model);
      return runtime.generateObject!(payload, options);
    }

    async createImage(payload: CreateImagePayload) {
      const runtime = await this.getRuntimeByModel(payload.model);
      return runtime.createImage!(payload);
    }

    async textToImage(payload: TextToImagePayload) {
      const runtime = await this.getRuntimeByModel(payload.model);
      return runtime.textToImage!(payload);
    }

    async models() {
      if (modelsOption && typeof modelsOption === 'function') {
        const runtimes = await this.createRuntimes();
        // If it's a functional configuration, use the last runtime's client to call the function
        const lastRuntime = runtimes.at(-1)?.runtime;
        if (lastRuntime && 'client' in lastRuntime) {
          const modelList = await modelsOption({ client: (lastRuntime as any).client });
          return await postProcessModelList(modelList);
        }
      }

      const runtimes = await this.createRuntimes();
      return runtimes.at(-1)?.runtime.models?.();
    }

    async embeddings(payload: EmbeddingsPayload, options?: EmbeddingsOptions) {
      const runtime = await this.getRuntimeByModel(payload.model);
      return runtime.embeddings!(payload, options);
    }

    async textToSpeech(payload: TextToSpeechPayload, options?: EmbeddingsOptions) {
      const runtime = await this.getRuntimeByModel(payload.model);
      return runtime.textToSpeech!(payload, options);
    }
  };
};

export type UniformRuntime = InstanceType<ReturnType<typeof createRouterRuntime>>;
