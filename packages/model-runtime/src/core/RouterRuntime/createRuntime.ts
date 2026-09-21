/**
 * @see https://github.com/lobehub/lobe-chat/discussions/6563
 */
import type { GoogleGenAIOptions } from '@google/genai';
import type {
  ChatModelCard,
  ModelPricingContext,
  RouterRuntimeRequestContext,
} from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { createTimingHelpers, getDurationMs } from '@lobechat/utils';
import debug from 'debug';
import { nanoid } from 'nanoid';
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
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { postProcessModelList } from '../../utils/postProcessModelList';
import { isImageDecodingRequestError, shouldStopFallbackForError } from '../../utils/routeFallback';
import { safeParseJSON } from '../../utils/safeParseJSON';
import { setRuntimeSignatureScopeSource } from '../../utils/signatureScope';
import type { LobeRuntimeAI } from '../BaseAI';
import type {
  CreateImageOptions,
  CreateVideoOptions,
  CustomClientOptions,
} from '../openaiCompatibleFactory';
import type { ApiType, RuntimeClass } from './apiTypes';
import { getChatAttemptObservation, observeChatAttempt } from './chatAttempt';
import type { ChatStreamFallbackAttempt } from './chatStreamFallback';
import { createChatStreamFallbackResponse } from './chatStreamFallback';
import type { RouteAttemptFinished, RouteAttemptResult, RouteAttemptStart } from './routeAttempt';
import { createRouteRequestTasks } from './routeRequestTasks';

export type { RouteAttemptResult } from './routeAttempt';

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
  /** Relative share of new user bindings; zero keeps the channel as fallback only. */
  weight?: number;
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
      runtimeContext: RouterRuntimeRequestContext,
    ) => RouterInstance[] | Promise<RouterInstance[]>);

interface RouteAttemptMetadata {
  apiType: string;
  channelId?: string;
  completionPending?: boolean;
  durationMs: number;
  optionIndex: number;
  providerId: string;
  routerId?: string;
  success: boolean;
  totalOptions: number;
}

interface RouteAttemptContext {
  allowedApiTypes?: ReadonlySet<ApiType>;
  metadata?: Record<string, unknown>;
  method: RouterRuntimeMethod;
  pricingContext?: ModelPricingContext;
  toolsCount?: number;
  user?: string;
}

const RAW_AUDIO_API_TYPES = new Set<ApiType>(['google', 'openai', 'vertexai']);

const hasRawAudioInput = (payload: ChatStreamPayload) =>
  payload.messages.some(
    (message) =>
      Array.isArray(message.content) && message.content.some((part) => part.type === 'audio_url'),
  );

interface RouteAttemptContextValidationParams extends RouteAttemptContext {
  apiType: string;
  channelId?: string;
  model: string;
  routerId?: string;
}

export interface SortRouterOptionsParams {
  metadata?: Record<string, unknown>;
  method: RouterRuntimeMethod;
  model: string;
  options: RouterOptionItem[];
  routerId?: string;
  userId?: string;
}

export interface RouteSuccessParams {
  channelId?: string;
  channelWeight?: number;
  firstChannelId?: string;
  method: RouterRuntimeMethod;
  model: string;
  routeRequestManaged?: boolean;
  routerId?: string;
  trackDeferredWork?: (task: Promise<void>) => void;
  userId?: string;
  weighted: boolean;
}

export type RouterRuntimeMethod =
  | 'chat'
  | 'createImage'
  | 'createVideo'
  | 'embeddings'
  | 'generateObject'
  | 'textToSpeech'
  | 'transcribe';

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
  onRouteAttemptFinished?: (result: RouteAttemptFinished) => Promise<void>;
  /** Awaited before returning so a successful fallback can update routing affinity. */
  onRouteSuccess?: (result: RouteSuccessParams) => void | Promise<void>;
  responses?: {
    handlePayload?: (
      payload: ChatStreamPayload,
      options: ConstructorOptions<T>,
    ) => ChatStreamPayload;
  };
  routers: Routers;
  /** Register once while the request context is available. */
  scheduleRouteRequestSettled?: (settled: Promise<void>) => void | Promise<void>;
  shouldFallbackChatAttempt?: (result: RouteAttemptFinished) => boolean | Promise<boolean>;
  shouldStopFallback?: (params: {
    error: unknown;
    metadata?: Record<string, unknown>;
    model: string;
    optionIndex: number;
  }) => boolean | Promise<boolean>;
  /**
   * Reorder fallback options before each request (e.g. demote temporarily
   * unhealthy channels). Must return a permutation of the input options;
   * any other result (wrong length, foreign items, thrown error) is ignored
   * so a misbehaving hook can never reduce availability.
   */
  sortRouterOptions?: (
    params: SortRouterOptionsParams,
  ) => RouterOptionItem[] | Promise<RouterOptionItem[]>;
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
      if (process.env.NODE_ENV !== 'development') return effectiveUserId;

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
      throw new Error(`[RouteAttemptMissingContext] ${JSON.stringify(diagnostic)}`);
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
    private async resolveRouters(
      runtimeContext: RouterRuntimeRequestContext = {},
    ): Promise<RouterInstance[]> {
      const startedAt = Date.now();
      const { model } = runtimeContext;
      try {
        const resolvedRouters =
          typeof this._routers === 'function'
            ? await this._routers(this._options, runtimeContext)
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

    private async resolveMatchedRouter(
      model: string,
      pricingContext?: ModelPricingContext,
    ): Promise<RouterInstance> {
      const startedAt = Date.now();
      const resolvedRouters = await this.resolveRouters({
        model,
        ...(pricingContext ? { pricingContext } : {}),
      });
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

    private async applySortRouterOptions(
      router: RouterInstance,
      model: string,
      routerOptions: RouterOptionItem[],
      routeContext: RouteAttemptContext,
    ): Promise<RouterOptionItem[]> {
      if (!params.sortRouterOptions || routerOptions.length <= 1) return routerOptions;

      const startedAt = Date.now();
      try {
        // Hand the hook a copy: hooks may sort in place (`options.sort(...)`), and the
        // input can be the shared `router.options` array reused across concurrent
        // requests. Keeping the original untouched also keeps it a trustworthy
        // baseline — validating a same-reference return would always pass, even
        // after mutations like `options.pop()`.
        const sorted = await params.sortRouterOptions({
          metadata: routeContext.metadata,
          method: routeContext.method,
          model,
          options: [...routerOptions],
          routerId: router.id,
          userId:
            (typeof this._options.userId === 'string' ? this._options.userId : undefined) ||
            routeContext.user,
        });
        const isPermutation =
          Array.isArray(sorted) &&
          sorted.length === routerOptions.length &&
          routerOptions.every((optionItem) => sorted.includes(optionItem));

        if (this._id === 'lobehub') {
          timing(
            'sortRouterOptions done model=%s routerId=%s durationMs=%d applied=%s',
            model,
            router.id,
            getDurationMs(startedAt),
            isPermutation,
          );
        }

        // Copy again so a hook retaining its returned array cannot mutate the
        // list while runWithFallback awaits provider calls between attempts.
        if (isPermutation) return [...sorted];

        log('sortRouterOptions returned a non-permutation result, ignoring');
        return routerOptions;
      } catch (error) {
        if (this._id === 'lobehub') {
          timing(
            'sortRouterOptions error model=%s routerId=%s durationMs=%d',
            model,
            router.id,
            getDurationMs(startedAt),
          );
        }
        log('sortRouterOptions callback error: %O', error);
        return routerOptions;
      }
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
      delete optionOverrides.weight;
      const resolvedApiType = optionApiType ?? router.apiType;
      const finalOptions = {
        ...this._params,
        ...this._options,
        ...optionOverrides,
      };
      const signatureScopeSource = {
        apiType: resolvedApiType,
        channelId,
        provider: this._id,
        routerId: router.id ?? this._id,
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

        const runtime = LobeVertexAI.initFromVertexAI(vertexOptions);
        setRuntimeSignatureScopeSource(runtime, signatureScopeSource);

        return {
          channelId,
          id: resolvedApiType,
          remark,
          runtime,
        };
      }

      const { baseRuntimeMap } = await import('./baseRuntimeMap');
      const providerAI =
        resolvedApiType === router.apiType
          ? (router.runtime ?? baseRuntimeMap[resolvedApiType] ?? LobeOpenAI)
          : (baseRuntimeMap[resolvedApiType] ?? LobeOpenAI);
      const runtime: LobeRuntimeAI = new providerAI({ ...finalOptions, id: this._id });
      setRuntimeSignatureScopeSource(runtime, signatureScopeSource);

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

    /**
     * Keep routed chat fallback open until the response body reaches a terminal
     * outcome. Bytes and callbacks remain private until the first visible model
     * output, preventing transparent replay after a partial answer or tool call.
     */
    private async runChatWithStreamFallback(
      payload: ChatStreamPayload,
      options: ChatMethodOptions | undefined,
      routeContext: RouteAttemptContext,
    ): Promise<Response> {
      const requestId = nanoid();
      const { allowedApiTypes, metadata, pricingContext, toolsCount, user } = routeContext;
      const matchedRouter = await this.resolveMatchedRouter(payload.model, pricingContext);
      const sortedRouterOptions = await this.applySortRouterOptions(
        matchedRouter,
        payload.model,
        this.normalizeRouterOptions(matchedRouter),
        routeContext,
      );
      const routerOptions = allowedApiTypes
        ? sortedRouterOptions.filter((option) =>
            allowedApiTypes.has(option.apiType ?? matchedRouter.apiType),
          )
        : sortedRouterOptions;

      if (routerOptions.length === 0) {
        throw new TypeError(
          `No provider route supports raw audio input for model ${payload.model}`,
        );
      }
      const firstChannelId = routerOptions[0]?.id;
      const weighted = routerOptions.some((option) => option.weight !== undefined);
      const routeTasks = params.scheduleRouteRequestSettled
        ? await createRouteRequestTasks(params.scheduleRouteRequestSettled)
        : undefined;

      const reportReturnedAttempt = (
        attempt: RouteAttemptStart,
        result: Partial<RouteAttemptResult> & Pick<RouteAttemptResult, 'durationMs' | 'success'>,
      ) => {
        if (!params.onRouteAttempt) return;
        try {
          const task = params.onRouteAttempt({ ...attempt, ...result } as RouteAttemptResult);
          if (routeTasks) routeTasks.track(task);
          else task.catch((error) => log('onRouteAttempt callback error: %O', error));
        } catch (error) {
          log('onRouteAttempt callback error: %O', error);
        }
      };

      const shouldContinueAfterRequestError = async (error: unknown, optionIndex: number) => {
        if (options?.signal?.aborted) return false;
        if (shouldStopFallbackForError(error)) return false;

        try {
          return !(await params.shouldStopFallback?.({
            error,
            metadata,
            model: payload.model,
            optionIndex,
          }));
        } catch (fallbackError) {
          log('shouldStopFallback callback error: %O', fallbackError);
          return true;
        }
      };

      const startAttempt = async (optionIndex: number): Promise<ChatStreamFallbackAttempt> => {
        const optionItem = routerOptions[optionIndex];
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
          method: routeContext.method,
          model: payload.model,
          routerId: matchedRouter.id,
          toolsCount,
          user,
        });
        const attempt: RouteAttemptStart = {
          apiType: resolvedApiType,
          attemptId: nanoid(),
          channelId,
          metadata: metadata ? { ...metadata } : undefined,
          model: payload.model,
          optionIndex,
          providerId: id,
          remark,
          requestId,
          routeRequestManaged: Boolean(routeTasks),
          routerId: matchedRouter.id,
          startedAt: Date.now(),
          userId: routeAttemptUserId,
        };

        try {
          const response = await observeChatAttempt(
            (attemptOptions) => runtime.chat!(payload, attemptOptions),
            options,
            attempt,
            payload.stream !== false,
            (result) => {
              const task = params.onRouteAttemptFinished!(result);
              if (routeTasks) routeTasks.track(Promise.resolve(task));
              else return task;
            },
            { deferCallbacks: true },
          );
          const durationMs = Date.now() - attempt.startedAt;
          reportReturnedAttempt(attempt, {
            completionPending: true,
            durationMs,
            success: true,
          });
          this.attachRouteAttemptMetadata(metadata, {
            apiType: resolvedApiType,
            channelId,
            completionPending: true,
            durationMs,
            optionIndex,
            providerId: id,
            routerId: matchedRouter.id,
            success: true,
            totalOptions: routerOptions.length,
          });

          const observation = getChatAttemptObservation(response);
          if (!observation) throw new Error('Missing chat attempt observation');

          return {
            index: optionIndex,
            observation,
            onCompleted: async () => {
              if (!params.onRouteSuccess) return;

              try {
                const task = Promise.resolve(
                  params.onRouteSuccess({
                    channelId,
                    channelWeight: optionItem.weight,
                    firstChannelId,
                    method: routeContext.method,
                    model: payload.model,
                    routerId: matchedRouter.id,
                    routeRequestManaged: Boolean(routeTasks),
                    trackDeferredWork: routeTasks?.track,
                    userId: routeAttemptUserId,
                    weighted,
                  }),
                );
                routeTasks?.track(task);
                await task;
              } catch (error) {
                // Affinity storage must not turn a successful upstream response into a fallback.
                console.error('[RouterRuntime] onRouteSuccess callback failed:', error);
              }
            },
            reader: response.body?.getReader(),
            response,
          };
        } catch (error) {
          const nonRetryable = shouldStopFallbackForError(error);
          const nonRetryableReason =
            nonRetryable && isImageDecodingRequestError(error)
              ? ('imageDecode' as const)
              : undefined;
          reportReturnedAttempt(attempt, {
            // Defer cancellation health handling to the terminal outcome, which intentionally ignores it.
            completionPending: options?.signal?.aborted ?? false,
            durationMs: Date.now() - attempt.startedAt,
            error,
            nonRetryable,
            nonRetryableReason,
            success: false,
          });

          if (
            optionIndex + 1 < routerOptions.length &&
            (await shouldContinueAfterRequestError(error, optionIndex))
          ) {
            return startAttempt(optionIndex + 1);
          }
          throw error;
        }
      };

      try {
        return await createChatStreamFallbackResponse({
          onSettled: routeTasks?.settle,
          shouldFallback: async (result) => {
            try {
              return Boolean(await params.shouldFallbackChatAttempt?.(result));
            } catch (error) {
              log('shouldFallbackChatAttempt callback error: %O', error);
              return false;
            }
          },
          startAttempt,
          totalAttempts: routerOptions.length,
        });
      } catch (error) {
        routeTasks?.settle();
        throw error;
      }
    }

    private async runWithFallback<T>(
      model: string,
      requestHandler: (runtime: LobeRuntimeAI, attempt: RouteAttemptStart) => Promise<T>,
      routeContext: RouteAttemptContext,
    ): Promise<T> {
      const totalStartedAt = Date.now();
      const requestId = nanoid();
      const { allowedApiTypes, metadata, pricingContext, toolsCount, user } = routeContext;
      const matchedRouter = await this.resolveMatchedRouter(model, pricingContext);
      const eligibleRouterOptions = this.normalizeRouterOptions(matchedRouter).filter(
        (option) =>
          !allowedApiTypes || allowedApiTypes.has(option.apiType ?? matchedRouter.apiType),
      );
      if (eligibleRouterOptions.length === 0) {
        throw new TypeError(`No provider route supports raw audio input for model ${model}`);
      }
      const routerOptions = await this.applySortRouterOptions(
        matchedRouter,
        model,
        eligibleRouterOptions,
        routeContext,
      );
      const totalOptions = routerOptions.length;
      const firstChannelId = routerOptions[0]?.id;
      const weighted = routerOptions.some((option) => option.weight !== undefined);

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
          method: routeContext.method,
          model,
          routerId: matchedRouter.id,
          toolsCount,
          user,
        });

        const attemptContext: RouteAttemptStart = {
          apiType: resolvedApiType,
          attemptId: nanoid(),
          channelId,
          metadata: metadata ? { ...metadata } : undefined,
          model,
          optionIndex: index,
          providerId: id,
          remark,
          requestId,
          routerId: matchedRouter.id,
          // Exclude lazy runtime construction from provider performance measurements.
          startedAt: Date.now(),
          userId: routeAttemptUserId,
        };

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
          const result = await requestHandler(runtime, attemptContext);
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

          if (params.onRouteSuccess) {
            try {
              await params.onRouteSuccess({
                channelId,
                channelWeight: optionItem.weight,
                firstChannelId,
                method: routeContext.method,
                model,
                routerId: matchedRouter.id,
                userId: routeAttemptUserId,
                weighted,
              });
            } catch (error) {
              // Affinity storage must not turn a successful upstream response into a fallback.
              console.error('[RouterRuntime] onRouteSuccess callback failed:', error);
            }
          }

          params
            .onRouteAttempt?.({
              ...attemptContext,
              apiType: resolvedApiType,
              channelId,
              durationMs: Date.now() - attemptContext.startedAt,
              metadata: attemptContext.metadata,
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
            durationMs: Date.now() - attemptContext.startedAt,
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

          const shouldStopFallback = shouldStopFallbackForError(error);
          const nonRetryableReason =
            shouldStopFallback && isImageDecodingRequestError(error)
              ? ('imageDecode' as const)
              : undefined;

          params
            .onRouteAttempt?.({
              ...attemptContext,
              apiType: resolvedApiType,
              channelId,
              durationMs: Date.now() - attemptContext.startedAt,
              error,
              metadata: attemptContext.metadata,
              model,
              nonRetryable: shouldStopFallback,
              nonRetryableReason,
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

          if (shouldStopFallback) {
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
        const containsRawAudio = hasRawAudioInput(payload);

        if (params.onRouteAttemptFinished && params.shouldFallbackChatAttempt) {
          return await this.runChatWithStreamFallback(payload, options, {
            allowedApiTypes: containsRawAudio ? RAW_AUDIO_API_TYPES : undefined,
            metadata: options?.metadata,
            method: 'chat',
            pricingContext: options?.pricingContext,
            toolsCount: payload.tools?.length ?? 0,
            user: options?.user,
          });
        }

        return await this.runWithFallback(
          payload.model,
          (runtime, attempt) =>
            params.onRouteAttemptFinished
              ? observeChatAttempt(
                  (attemptOptions) => runtime.chat!(payload, attemptOptions),
                  options,
                  attempt,
                  payload.stream !== false,
                  params.onRouteAttemptFinished,
                )
              : runtime.chat!(payload, options),
          {
            allowedApiTypes: containsRawAudio ? RAW_AUDIO_API_TYPES : undefined,
            metadata: options?.metadata,
            method: 'chat',
            pricingContext: options?.pricingContext,
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
        {
          metadata: options?.metadata,
          method: 'createImage',
          pricingContext: options?.pricingContext,
        },
      );
    }

    async createVideo(payload: CreateVideoPayload, options?: CreateVideoMethodOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.createVideo!(payload, options),
        {
          metadata: options?.metadata,
          method: 'createVideo',
          pricingContext: options?.pricingContext,
        },
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
      const resolvedRouters = await this.resolveRouters({ model });
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
          method: 'generateObject',
          pricingContext: options?.pricingContext,
          toolsCount: payload.tools?.length ?? 0,
          user: options?.user,
        },
      );
    }

    async embeddings(payload: EmbeddingsPayload, options?: EmbeddingsOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.embeddings!(payload, options),
        {
          metadata: options?.metadata,
          method: 'embeddings',
          pricingContext: options?.pricingContext,
          user: options?.user,
        },
      );
    }

    async textToSpeech(payload: TextToSpeechPayload, options?: EmbeddingsOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.textToSpeech!(payload, options),
        {
          metadata: options?.metadata,
          method: 'textToSpeech',
          pricingContext: options?.pricingContext,
          user: options?.user,
        },
      );
    }

    async transcribe(payload: ASRPayload, options?: ASROptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.transcribe!(payload, options),
        { method: 'transcribe', user: options?.user },
      );
    }
  };
};

export type UniformRuntime = InstanceType<ReturnType<typeof createRouterRuntime>>;
