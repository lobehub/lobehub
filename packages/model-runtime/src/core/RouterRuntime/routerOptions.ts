import type { ChatModelCard, RouterRuntimeRequestContext } from '@lobechat/types';
import type { ClientOptions } from 'openai';
import type OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

import type {
  ChatCompletionErrorPayload,
  ChatStreamCallbacks,
  ChatStreamPayload,
  CreateImagePayload,
  CreateImageResponse,
  CreateVideoPayload,
  CreateVideoResult,
  HandleCreateVideoWebhookPayload,
  HandleCreateVideoWebhookResult,
  ILobeAgentRuntimeErrorType,
} from '../../types';
import type {
  CreateImageOptions,
  CreateVideoOptions,
  CustomClientOptions,
} from '../openaiCompatibleFactory';
import type { ApiType, RuntimeClass } from './apiTypes';
import type { RouteAttemptFinished, RouteAttemptResult } from './routeAttempt';

export interface ProviderIniOptions extends Record<string, any> {
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
export interface RouterOptionItem extends ProviderIniOptions {
  apiType?: ApiType;
  id?: string;
  remark?: string;
  /** Relative share of new user bindings; zero keeps the channel as fallback only. */
  weight?: number;
}

export type RouterOptions = RouterOptionItem | RouterOptionItem[];

export interface RouterInstance {
  apiType: ApiType;
  baseURLPattern?: RegExp;
  id?: string;
  models?: string[];
  options: RouterOptions;
  runtime?: RuntimeClass;
}

// OpenAI SDK v6 widened `apiKey` to `string | ApiKeySetter`; lobehub only ever
// passes a plain string, so narrow it back to keep `.trim()` / string assignments valid.
export type LobeClientOptions = Omit<ClientOptions, 'apiKey'> & { apiKey?: string };
export type ConstructorOptions<T extends Record<string, any> = any> = LobeClientOptions & T;

export type Routers =
  | RouterInstance[]
  | ((
      options: LobeClientOptions & Record<string, any>,
      runtimeContext: RouterRuntimeRequestContext,
    ) => RouterInstance[] | Promise<RouterInstance[]>);

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
  | 'decide'
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
  ) => Promise<CreateVideoResult>;
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
