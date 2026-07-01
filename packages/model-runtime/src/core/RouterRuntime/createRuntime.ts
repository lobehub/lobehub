/**
 * @see https://github.com/lobehub/lobe-chat/discussions/6563
 */
import type { GoogleGenAIOptions } from '@google/genai';
import type { ChatModelCard } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { createTimingHelpers, getDurationMs } from '@lobechat/utils';
import debug from 'debug';
import type { ClientOptions } from 'openai';
import type OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

import { LobeOpenAI } from '../../providers/openai';
import { LobeVertexAI } from '../../providers/vertexai';
import type {
  ASROptions,
  ASRPayload,
  ChatCompletionErrorPayload,
  ChatMethodOptions,
  ChatStreamCallbacks,
  ChatStreamPayload,
  CreateImageMethodOptions,
  CreateImagePayload,
  CreateImageResponse,
  CreateVideoMethodOptions,
  CreateVideoPayload,
  CreateVideoResponse,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  HandleCreateVideoWebhookPayload,
  HandleCreateVideoWebhookResult,
  ILobeAgentRuntimeErrorType,
  TextToSpeechPayload,
} from '../../types';
import { AgentRuntimeError } from '../../utils/createError';
import { isNonRetryableRequestError } from '../../utils/isNonRetryableRequestError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { postProcessModelList } from '../../utils/postProcessModelList';
import { safeParseJSON } from '../../utils/safeParseJSON';
import type { LobeRuntimeAI } from '../BaseAI';
import type {
  CreateImageOptions,
  CreateVideoOptions,
  CustomClientOptions,
} from '../openaiCompatibleFactory';
import type { ApiType, RuntimeClass } from './apiTypes';

const log = debug('lobe-model-runtime:router-runtime');
const { logger: timing } = createTimingHelpers('lobe-server:chat:lobehub:timing');

interface ProviderIniOptions extends Record<string, any> {
  accessKeyId?: string;
  accessKeySecret?: string;
  apiKey?: string;
  apiVersion?: string;
  baseURL?: string;
  baseURLOrAccountID?: string;
  dangerouslyAllowBrowser?: boolean;
  modelIdMapping?: Record<string, string>;
  region?: string;
  sdkType?: string;
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

// OpenAI SDK v6 widened `apiKey` to `string | ApiKeySetter`; lobehub only ever
// passes a plain string, so narrow it back to keep `.trim()` / string assignments valid.
type LobeClientOptions = Omit<ClientOptions, 'apiKey'> & { apiKey?: string };
type ConstructorOptions<T extends Record<string, any> = any> = LobeClientOptions & T;

type Routers =
  | RouterInstance[]
  | ((
      options: LobeClientOptions & Record<string, any>,
      runtimeContext: {
        model?: string;
      },
    ) => RouterInstance[] | Promise<RouterInstance[]>);

export interface RouteAttemptResult {
  apiType: string;
  channelId?: string;
  durationMs: number;
  error?: unknown;
  metadata?: Record<string, unknown>;
  model: string;
  optionIndex: number;
  providerId: string;
  remark?: string;
  routerId?: string;
  success: boolean;
  userId?: string;
}

interface RouteAttemptMetadata {
  apiType: string;
  channelId?: string;
  durationMs: number;
  optionIndex: number;
  providerId: string;
  routerId?: string;
  success: boolean;
  totalOptions: number;
}

interface RouteAttemptContext {
  metadata?: Record<string, unknown>;
  toolsCount?: number;
  user?: string;
}

interface RouteAttemptContextValidationParams extends RouteAttemptContext {
  apiType: string;
  channelId?: string;
  model: string;
  routerId?: string;
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
  createVideo?: (
    payload: CreateVideoPayload,
    options: CreateVideoOptions,
  ) => Promise<CreateVideoResponse>;
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
  handleCreateVideoWebhook?: (
    payload: HandleCreateVideoWebhookPayload,
    options: CreateVideoOptions,
  ) => Promise<HandleCreateVideoWebhookResult>;
  id: string;
  models?:
    | ((params: { client: OpenAI; options?: ConstructorOptions<T> }) => Promise<ChatModelCard[]>)
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
  shouldStopFallback?: (params: {
    error: unknown;
    metadata?: Record<string, unknown>;
    model: string;
    optionIndex: number;
  }) => boolean | Promise<boolean>;
}

export const createRouterRuntime = ({
  id,
  routers,
  apiKey: DEFAULT_API_KEY,
  models: modelsOption,
  ...params
}: CreateRouterRuntimeOptions) => {
  return class UniformRuntime implements LobeRuntimeAI {
    public _options: LobeClientOptions & Record<string, any>;
    private _routers: Routers;
    private _params: any;
    private _id: string;

    private attachRouteAttemptMetadata(
      metadata: Record<string, unknown> | undefined,
      routeAttempt: RouteAttemptMetadata,
    ) {
      if (!metadata || this._id !== 'lobehub') return;

      metadata.routeAttempt = routeAttempt;
    }

    private validateRouteAttemptContext({
      apiType,
      channelId,
      metadata,
      model,
      routerId,
      toolsCount,
      user,
    }: RouteAttemptContextValidationParams) {
      const runtimeUserId =
        typeof this._options.userId === 'string' ? this._options.userId : undefined;
      const effectiveUserId = runtimeUserId || user;
      const trigger = metadata?.trigger;
      const traceId = typeof metadata?.traceId === 'string' ? metadata.traceId : undefined;

      if (this._id !== 'lobehub' || (effectiveUserId && trigger)) return effectiveUserId;

      const diagnostic = {
        apiType,
        channelId,
        metadataKeys: Object.keys(metadata ?? {}),
        missingTrigger: !trigger,
        missingUser: !effectiveUserId,
        model,
        optionUserPresent: Boolean(user),
        providerId: this._id,
        routerId,
        runtimeUserIdPresent: Boolean(runtimeUserId),
        stack: new Error('RouteAttemptMissingContext').stack?.split('\n').slice(0, 20),
        toolsCount: toolsCount ?? 0,
        traceId,
        trigger,
      };

      // Example bug: modelRuntime.chat(payload) without metadata would record trigger=null.
      if (process.env.NODE_ENV === 'development') {
        throw new Error(`[RouteAttemptMissingContext] ${JSON.stringify(diagnostic)}`);
      }

      console.error('[RouteAttemptMissingContext]', JSON.stringify(diagnostic));

      return effectiveUserId;
    }

    constructor(options: LobeClientOptions & Record<string, any> = {}) {
      const startedAt = Date.now();
      this._options = {
        ...options,
        apiKey: options.apiKey?.trim() || DEFAULT_API_KEY,
        baseURL: options.baseURL?.trim(),
      };

      // Save configuration without creating runtimes
      this._routers = routers;
      this._params = params;
      this._id = options.id ?? id;

      if (this._id === 'lobehub') {
        timing(
          'constructor done providerId=%s durationMs=%d hasApiKey=%s hasBaseURL=%s',
          this._id,
          getDurationMs(startedAt),
          !!this._options.apiKey,
          !!this._options.baseURL,
        );
      }
    }

    /**
     * Resolve routers configuration and validate
     */
    private async resolveRouters(model?: string): Promise<RouterInstance[]> {
      const startedAt = Date.now();
      try {
        const resolvedRouters =
          typeof this._routers === 'function'
            ? await this._routers(this._options, { model })
            : this._routers;

        if (this._id === 'lobehub') {
          timing(
            'resolveRouters done model=%s durationMs=%d routerCount=%d dynamic=%s',
            model,
            getDurationMs(startedAt),
            resolvedRouters.length,
            typeof this._routers === 'function',
          );
        }

        if (resolvedRouters.length === 0) {
          throw AgentRuntimeError.chat({
            error: { message: 'empty providers' },
            errorType: AgentRuntimeErrorType.NoAvailableProvider,
            provider: this._id,
          });
        }

        return resolvedRouters;
      } catch (error) {
        if (this._id === 'lobehub') {
          timing('resolveRouters error model=%s durationMs=%d', model, getDurationMs(startedAt));
        }
        throw error;
      }
    }

    private async resolveMatchedRouter(model: string): Promise<RouterInstance> {
      const startedAt = Date.now();
      const resolvedRouters = await this.resolveRouters(model);
      const baseURL = this._options.baseURL;

      // Priority 1: Match by baseURLPattern (RegExp only)
      if (baseURL) {
        const baseURLMatch = resolvedRouters.find((router) => router.baseURLPattern?.test(baseURL));
        if (baseURLMatch) {
          if (this._id === 'lobehub') {
            timing(
              'resolveMatchedRouter done model=%s match=baseURL routerId=%s apiType=%s durationMs=%d',
              model,
              baseURLMatch.id,
              baseURLMatch.apiType,
              getDurationMs(startedAt),
            );
          }
          return baseURLMatch;
        }
      }

      // Priority 2: Match by models
      const modelMatch = resolvedRouters.find((router) => {
        if (router.models && router.models.length > 0) {
          return router.models.includes(model);
        }
        return false;
      });
      if (modelMatch) {
        if (this._id === 'lobehub') {
          timing(
            'resolveMatchedRouter done model=%s match=models routerId=%s apiType=%s durationMs=%d',
            model,
            modelMatch.id,
            modelMatch.apiType,
            getDurationMs(startedAt),
          );
        }
        return modelMatch;
      }

      // Fallback: Use the last router
      const fallbackRouter = resolvedRouters.at(-1)!;
      if (this._id === 'lobehub') {
        timing(
          'resolveMatchedRouter done model=%s match=fallback routerId=%s apiType=%s durationMs=%d',
          model,
          fallbackRouter.id,
          fallbackRouter.apiType,
          getDurationMs(startedAt),
        );
      }
      return fallbackRouter;
    }

    private normalizeRouterOptions(router: RouterInstance): RouterOptionItem[] {
      const startedAt = Date.now();
      const routerOptions = Array.isArray(router.options) ? router.options : [router.options];

      if (routerOptions.length === 0 || routerOptions.some((optionItem) => !optionItem)) {
        throw new Error('empty provider options');
      }

      if (this._id === 'lobehub') {
        timing(
          'normalizeRouterOptions done routerId=%s options=%d durationMs=%d',
          router.id,
          routerOptions.length,
          getDurationMs(startedAt),
        );
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
      const startedAt = Date.now();
      const { apiType: optionApiType, id: channelId, remark, ...optionOverrides } = optionItem;
      const resolvedApiType = optionApiType ?? router.apiType;
      const finalOptions = {
        ...this._params,
        ...this._options,
        ...optionOverrides,
      };

      /**
       * Vertex AI uses GoogleGenAI credentials flow rather than API keys.
       * Accept JSON credentials in apiKey for compatibility with server config.
       */
      if (resolvedApiType === 'vertexai') {
        const { apiKey, googleAuthOptions, project, location, ...restOptions } = finalOptions;
        const credentials = safeParseJSON<Record<string, any>>(apiKey);
        const vertexOptions: GoogleGenAIOptions & ModelIdMappingOptions = {
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

        if (this._id === 'lobehub') {
          timing(
            'createRuntimeFromOption done routerId=%s channelId=%s apiType=%s durationMs=%d vertex=true',
            router.id,
            channelId,
            resolvedApiType,
            getDurationMs(startedAt),
          );
        }

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

      if (this._id === 'lobehub') {
        timing(
          'createRuntimeFromOption done routerId=%s channelId=%s apiType=%s durationMs=%d',
          router.id,
          channelId,
          resolvedApiType,
          getDurationMs(startedAt),
        );
      }

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
      routeContext: RouteAttemptContext = {},
    ): Promise<T> {
      const totalStartedAt = Date.now();
      const { metadata, toolsCount, user } = routeContext;
      const matchedRouter = await this.resolveMatchedRouter(model);
      const routerOptions = this.normalizeRouterOptions(matchedRouter);
      const totalOptions = routerOptions.length;

      if (this._id === 'lobehub') {
        timing(
          'runWithFallback start model=%s routerId=%s apiType=%s options=%d traceId=%s',
          model,
          matchedRouter.id,
          matchedRouter.apiType,
          totalOptions,
          metadata?.traceId,
        );
      }

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
        const routeAttemptUserId = this.validateRouteAttemptContext({
          apiType: resolvedApiType,
          channelId,
          metadata,
          model,
          routerId: matchedRouter.id,
          toolsCount,
          user,
        });

        try {
          if (this._id === 'lobehub') {
            timing(
              'attempt request start model=%s attempt=%d/%d routerId=%s channelId=%s apiType=%s traceId=%s',
              model,
              attempt,
              totalOptions,
              matchedRouter.id,
              channelId,
              resolvedApiType,
              metadata?.traceId,
            );
          }
          const result = await requestHandler(runtime);
          if (this._id === 'lobehub') {
            timing(
              'attempt request success model=%s attempt=%d/%d routerId=%s channelId=%s apiType=%s durationMs=%d totalMs=%d traceId=%s',
              model,
              attempt,
              totalOptions,
              matchedRouter.id,
              channelId,
              resolvedApiType,
              getDurationMs(startTime),
              getDurationMs(totalStartedAt),
              metadata?.traceId,
            );
          }

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
          } else {
            log(
              'request success without fallback for model=%s apiType=%s channelId=%s remark=%s',
              model,
              resolvedApiType,
              channelId ?? '',
              remark ?? '',
            );
          }

          params
            .onRouteAttempt?.({
              apiType: resolvedApiType,
              channelId,
              durationMs: Date.now() - startTime,
              metadata,
              model,
              optionIndex: index,
              providerId: id,
              remark,
              routerId: matchedRouter.id,
              success: true,
              userId: routeAttemptUserId,
            })
            .catch((e) => {
              log('onRouteAttempt callback error: %O', e);
            });

          this.attachRouteAttemptMetadata(metadata, {
            apiType: resolvedApiType,
            channelId,
            durationMs: Date.now() - startTime,
            optionIndex: index,
            providerId: id,
            routerId: matchedRouter.id,
            success: true,
            totalOptions,
          });

          return result;
        } catch (error) {
          lastError = error;
          if (this._id === 'lobehub') {
            timing(
              'attempt request error model=%s attempt=%d/%d routerId=%s channelId=%s apiType=%s durationMs=%d totalMs=%d traceId=%s',
              model,
              attempt,
              totalOptions,
              matchedRouter.id,
              channelId,
              resolvedApiType,
              getDurationMs(startTime),
              getDurationMs(totalStartedAt),
              metadata?.traceId,
            );
          }

          params
            .onRouteAttempt?.({
              apiType: resolvedApiType,
              channelId,
              durationMs: Date.now() - startTime,
              error,
              metadata,
              model,
              optionIndex: index,
              providerId: id,
              remark,
              routerId: matchedRouter.id,
              success: false,
              userId: routeAttemptUserId,
            })
            .catch((e) => {
              log('onRouteAttempt callback error: %O', e);
            });

          if (isNonRetryableRequestError(error)) {
            throw error;
          }

          try {
            const shouldStopStartedAt = Date.now();
            const shouldStopFallback = await params.shouldStopFallback?.({
              error,
              metadata,
              model,
              optionIndex: index,
            });

            if (this._id === 'lobehub') {
              timing(
                'shouldStopFallback done model=%s attempt=%d/%d durationMs=%d shouldStop=%s traceId=%s',
                model,
                attempt,
                totalOptions,
                getDurationMs(shouldStopStartedAt),
                shouldStopFallback,
                metadata?.traceId,
              );
            }

            if (shouldStopFallback) {
              throw error;
            }
          } catch (fallbackError) {
            if (fallbackError === error) {
              throw error;
            }

            log('shouldStopFallback callback error: %O', fallbackError);
          }

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

      if (this._id === 'lobehub') {
        timing(
          'runWithFallback failed model=%s routerId=%s options=%d totalMs=%d traceId=%s',
          model,
          matchedRouter.id,
          totalOptions,
          getDurationMs(totalStartedAt),
          metadata?.traceId,
        );
      }

      throw lastError ?? new Error('empty provider options');
    }

    async models() {
      const resolvedRouters = await this.resolveRouters();
      const matchedRouter = this._options.baseURL
        ? (resolvedRouters.find((router) => router.baseURLPattern?.test(this._options.baseURL!)) ??
          resolvedRouters.at(-1)!)
        : resolvedRouters.at(-1)!;
      const routerOptions = this.normalizeRouterOptions(matchedRouter);
      const { runtime } = await this.createRuntimeFromOption(matchedRouter, routerOptions[0]);

      if (
        modelsOption &&
        typeof modelsOption === 'function' && // Use the same baseURL-matched runtime as chat routing for provider model discovery.
        'client' in runtime
      ) {
        const modelList = await modelsOption({
          client: (runtime as any).client,
          options: this._options,
        });
        return await postProcessModelList(modelList);
      }

      return runtime.models?.();
    }

    /**
     * Try router options in order for chat requests.
     * When options is an array, fall back to the next item on failure.
     */
    async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
      try {
        return await this.runWithFallback(
          payload.model,
          (runtime) => runtime.chat!(payload, options),
          {
            metadata: options?.metadata,
            toolsCount: payload.tools?.length ?? 0,
            user: options?.user,
          },
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

    async createImage(payload: CreateImagePayload, options?: CreateImageMethodOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.createImage!(payload, options),
        { metadata: options?.metadata },
      );
    }

    async createVideo(payload: CreateVideoPayload, options?: CreateVideoMethodOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.createVideo!(payload, options),
        { metadata: options?.metadata },
      );
    }

    async handlePollVideoStatus(inferenceId: string) {
      const resolvedRouters = await this.resolveRouters();
      const matchedRouter = this._options.baseURL
        ? (resolvedRouters.find((router) => router.baseURLPattern?.test(this._options.baseURL!)) ??
          resolvedRouters.at(-1)!)
        : resolvedRouters.at(-1)!;
      const routerOptions = this.normalizeRouterOptions(matchedRouter);
      const { runtime } = await this.createRuntimeFromOption(matchedRouter, routerOptions[0]);

      if (!runtime.handlePollVideoStatus) {
        throw new Error('Video polling is not supported by the matched runtime');
      }

      return runtime.handlePollVideoStatus(inferenceId);
    }

    async handleCreateVideoWebhook(payload: HandleCreateVideoWebhookPayload) {
      const model = (payload.body as any)?.model;
      const resolvedRouters = await this.resolveRouters(model);
      const routerOptions = this.normalizeRouterOptions(resolvedRouters[0]);
      const { runtime } = await this.createRuntimeFromOption(resolvedRouters[0], routerOptions[0]);
      return runtime.handleCreateVideoWebhook!(payload);
    }

    async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.generateObject!(payload, options),
        {
          metadata: options?.metadata,
          toolsCount: payload.tools?.length ?? 0,
          user: options?.user,
        },
      );
    }

    async embeddings(payload: EmbeddingsPayload, options?: EmbeddingsOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.embeddings!(payload, options),
        { metadata: options?.metadata, user: options?.user },
      );
    }

    async textToSpeech(payload: TextToSpeechPayload, options?: EmbeddingsOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.textToSpeech!(payload, options),
        {
          metadata: options?.metadata,
          user: options?.user,
        },
      );
    }

    async transcribe(payload: ASRPayload, options?: ASROptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.transcribe!(payload, options),
        { user: options?.user },
      );
    }
  };
};

export type UniformRuntime = InstanceType<ReturnType<typeof createRouterRuntime>>;
