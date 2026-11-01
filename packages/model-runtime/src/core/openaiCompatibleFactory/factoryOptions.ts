import type { ChatModelCard } from '@lobechat/types';
import type { AiFullModelCard } from 'model-bank';
import type { ClientOptions } from 'openai';
import type OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

import type {
  ChatCompletionErrorPayload,
  ChatStreamCallbacks,
  ChatStreamPayload,
  GenerateObjectPayload,
} from '../../types';
import type { ILobeAgentRuntimeErrorType } from '../../types/error';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import type {
  CreateVideoPayload,
  CreateVideoResult,
  HandleCreateVideoWebhookPayload,
  HandleCreateVideoWebhookResult,
  PollVideoStatusResult,
  VideoGenerationCapabilities,
} from '../../types/video';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import type { AssertContextWithinWindowOptions } from '../../utils/resolveSafeMaxTokens';
import type { ChatPayloadForTransformStream } from '../streams/protocol';
import type { DecideConfig } from './decide';

// OpenAI SDK v6 widened `apiKey` to `string | ApiKeySetter`; lobehub only ever
// passes a plain string, so narrow it back to keep `.trim()` / string assignments valid.
export type LobeClientOptions = Omit<ClientOptions, 'apiKey'> & { apiKey?: string };
export type ConstructorOptions<T extends Record<string, any> = any> = LobeClientOptions &
  ModelIdMappingOptions &
  T;
export type OpenAIExtraParams = { prompt_cache_key?: string; safety_identifier?: string };
export type ChatCompletionCreateParamsWithPromptCacheKey = Omit<
  OpenAI.ChatCompletionCreateParamsNonStreaming,
  'reasoning_effort'
> &
  Pick<OpenAIExtraParams, 'prompt_cache_key'> &
  Pick<GenerateObjectPayload, 'reasoning_effort'>;
export type ResponseCreateParamsWithPromptCacheKey = (
  OpenAI.Responses.ResponseCreateParamsStreaming | OpenAI.Responses.ResponseCreateParams
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
    /** Convert internal audio_url parts to OpenAI input_audio (WAV/MP3 only). */
    supportsAudioInput?: boolean;
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
  ) => Promise<CreateVideoResult>;
  customClient?: CustomClientOptions<T>;
  debug?: {
    chatCompletion: () => boolean;
    responses?: () => boolean;
  };
  decide?: DecideConfig;
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
    | ((params: { client: OpenAI; options?: ConstructorOptions<T> }) => Promise<ChatModelCard[]>)
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
    prepareRequest?: (
      payload: ResponseCreateParamsWithPromptCacheKey,
      options: ConstructorOptions<T>,
    ) => {
      headers?: Record<string, string>;
      payload: ResponseCreateParamsWithPromptCacheKey;
    };
  };
  videoGenerationCapabilities?:
    VideoGenerationCapabilities | ((model: string) => VideoGenerationCapabilities);
}
