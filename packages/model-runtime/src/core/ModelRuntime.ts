import type { ModelUsage, TracePayload } from '@lobechat/types';
import type { ClientOptions } from 'openai';

import type { LobeBedrockAIParams } from '../providers/bedrock';
import type { LobeCloudflareParams } from '../providers/cloudflare';
import { LobeOpenAI } from '../providers/openai';
import { providerRuntimeMap } from '../runtimeMap';
import type {
  ChatCompletionErrorPayload,
  ChatMethodOptions,
  ChatStreamPayload,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  ModelRequestOptions,
  OnFinishData,
  PullModelParams,
  TextToSpeechPayload,
} from '../types';
import { AgentRuntimeErrorType } from '../types/error';
import type { AuthenticatedImageRuntime, CreateImagePayload } from '../types/image';
import type { CreateVideoPayload, HandleCreateVideoWebhookPayload } from '../types/video';
import { AgentRuntimeError } from '../utils/createError';
import type { LobeRuntimeAI } from './BaseAI';

export interface AgentChatOptions {
  enableTrace?: boolean;
  provider: string;
  trace?: TracePayload;
}

export interface ModelRuntimeHooks {
  /**
   * Runs before the LLM call. Throw to abort (e.g., budget exceeded).
   */
  beforeChat?: (payload: ChatStreamPayload, options?: ChatMethodOptions) => Promise<void>;
  beforeEmbeddings?: (payload: EmbeddingsPayload, options?: EmbeddingsOptions) => Promise<void>;
  beforeGenerateObject?: (
    payload: GenerateObjectPayload,
    options?: GenerateObjectOptions,
  ) => Promise<void>;
  /**
   * Called when chat() throws. Handle side effects (sanitize, log, DB record).
   * The error is re-thrown after the hook completes — callers still handle response formatting.
   */
  onChatError?: (
    error: ChatCompletionErrorPayload,
    context: { options?: ChatMethodOptions; payload: ChatStreamPayload },
  ) => void | Promise<void>;

  /**
   * Called after the stream completes. ModelRuntime handles merging into onFinal internally.
   * Hook consumers only need to implement the callback — no need to deal with option merging.
   */
  onChatFinal?: (
    data: OnFinishData,
    context: { options?: ChatMethodOptions; payload: ChatStreamPayload },
  ) => void | Promise<void>;

  onEmbeddingsError?: (
    error: ChatCompletionErrorPayload,
    context: { options?: EmbeddingsOptions; payload: EmbeddingsPayload },
  ) => void | Promise<void>;

  onEmbeddingsFinal?: (
    data: { latencyMs?: number; usage?: ModelUsage },
    context: { options?: EmbeddingsOptions; payload: EmbeddingsPayload },
  ) => void | Promise<void>;

  onGenerateObjectError?: (
    error: ChatCompletionErrorPayload,
    context: { options?: GenerateObjectOptions; payload: GenerateObjectPayload },
  ) => void | Promise<void>;

  onGenerateObjectFinal?: (
    data: { usage?: ModelUsage },
    context: { options?: GenerateObjectOptions; payload: GenerateObjectPayload },
  ) => void | Promise<void>;
}

export class ModelRuntime {
  private _hooks?: ModelRuntimeHooks;
  private _runtime: LobeRuntimeAI;

  constructor(runtime: LobeRuntimeAI, hooks?: ModelRuntimeHooks) {
    this._runtime = runtime;
    this._hooks = hooks;
  }

  /**
   * Initiates a chat session with the agent.
   *
   * @param payload - The payload containing the chat stream data.
   * @param options - Optional chat competition options.
   * @returns A Promise that resolves to the chat response.
   *
   * @example - Use without trace
   * ```ts
   * const agentRuntime = await initializeWithClientStore({ provider, payload });
   * const data = payload as ChatStreamPayload;
   * return await agentRuntime.chat(data);
   * ```
   *
   * @example - Use Langfuse trace
   * ```ts
   * // ============  1. init chat model   ============ //
   * const agentRuntime = await initAgentRuntimeWithUserPayload(provider, jwtPayload);
   * // ============  2. create chat completion   ============ //
   * const data = {
   * // your trace options here
   *  } as ChatStreamPayload;
   * const tracePayload = getTracePayload(req);
   * return await agentRuntime.chat(data, createTraceOptions(data, {
   *   provider,
   *   trace: tracePayload,
   * }));
   * ```
   */
  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    if (typeof this._runtime.chat !== 'function') {
      throw AgentRuntimeError.chat({
        error: new Error('Chat is not supported by this provider'),
        errorType: AgentRuntimeErrorType.ProviderBizError,
        provider: payload.provider || 'unknown',
      });
    }

    const finalOptions = await this.applyHooks(payload, options);

    try {
      return await this._runtime.chat(payload, finalOptions);
    } catch (error) {
      if (this._hooks?.onChatError) {
        await this._hooks.onChatError(error as ChatCompletionErrorPayload, { options, payload });
      }
      throw error;
    }
  }

  /**
   * Apply lifecycle hooks: beforeChat (budget check) + onChatFinal (cost tracking callback injection).
   */
  private async applyHooks(
    payload: ChatStreamPayload,
    options?: ChatMethodOptions,
  ): Promise<ChatMethodOptions | undefined> {
    await this._hooks?.beforeChat?.(payload, options);

    if (!this._hooks?.onChatFinal) return options;

    const hookFn = this._hooks.onChatFinal;
    const existingOnFinal = options?.callback?.onFinal;
    return {
      ...options,
      callback: {
        ...options?.callback,
        async onFinal(data) {
          await existingOnFinal?.(data);
          try {
            await hookFn(data, { options, payload });
          } catch (e) {
            // Hook failures (billing, tracing) must not interfere with response completion
            console.error('[ModelRuntime] onChatFinal hook error:', e);
          }
        },
      },
    };
  }

  async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    await this._hooks?.beforeGenerateObject?.(payload, options);

    const finalOptions = this._hooks?.onGenerateObjectFinal
      ? {
          ...options,
          onUsage: async (usage: ModelUsage) => {
            await options?.onUsage?.(usage);
            try {
              await this._hooks!.onGenerateObjectFinal!({ usage }, { options, payload });
            } catch (e) {
              // Hook failures (billing, tracing) must not interfere with response completion
              console.error('[ModelRuntime] onGenerateObjectFinal hook error:', e);
            }
          },
        }
      : options;

    try {
      return await this._runtime.generateObject!(payload, finalOptions);
    } catch (error) {
      if (this._hooks?.onGenerateObjectError) {
        await this._hooks.onGenerateObjectError(error as ChatCompletionErrorPayload, {
          options,
          payload,
        });
      }
      throw error;
    }
  }

  async createImage(payload: CreateImagePayload) {
    return this._runtime.createImage?.(payload);
  }

  async createVideo(payload: CreateVideoPayload) {
    return this._runtime.createVideo?.(payload);
  }

  async handleCreateVideoWebhook(payload: HandleCreateVideoWebhookPayload) {
    return this._runtime.handleCreateVideoWebhook?.(payload);
  }

  async models() {
    return this._runtime.models?.();
  }

  async embeddings(payload: EmbeddingsPayload, options?: EmbeddingsOptions) {
    await this._hooks?.beforeEmbeddings?.(payload, options);

    const startTime = Date.now();

    const finalOptions = this._hooks?.onEmbeddingsFinal
      ? {
          ...options,
          onUsage: async (usage: ModelUsage) => {
            await options?.onUsage?.(usage);
            try {
              const latencyMs = Date.now() - startTime;
              await this._hooks!.onEmbeddingsFinal!({ latencyMs, usage }, { options, payload });
            } catch (e) {
              console.error('[ModelRuntime] onEmbeddingsFinal hook error:', e);
            }
          },
        }
      : options;

    try {
      return await this._runtime.embeddings?.(payload, finalOptions);
    } catch (error) {
      if (this._hooks?.onEmbeddingsError) {
        await this._hooks.onEmbeddingsError(error as ChatCompletionErrorPayload, {
          options,
          payload,
        });
      }
      throw error;
    }
  }
  async textToSpeech(payload: TextToSpeechPayload, options?: EmbeddingsOptions) {
    return this._runtime.textToSpeech?.(payload, options);
  }

  async pullModel(params: PullModelParams, options?: ModelRequestOptions) {
    return this._runtime.pullModel?.(params, options);
  }

  /**
   * Get authentication headers if runtime supports it
   */
  getAuthHeaders(): Record<string, string> | undefined {
    return (this._runtime as AuthenticatedImageRuntime).getAuthHeaders?.();
  }

  /**
   * @description Initialize the runtime with the provider and the options
   * @param provider choose a model provider
   * @param params options of the choosed provider
   * @param hooks optional hooks for lifecycle interception (billing, etc.)
   * @returns the runtime instance
   * Try to initialize the runtime with the provider and the options.
   * @example
   * ```ts
   * const runtime = await AgentRuntime.initializeWithProviderOptions(provider, options)
   * ```
   * **Note**: If you try to get a AgentRuntime instance from client or server,
   * you should use the methods to get the runtime instance at first.
   * - `src/app/api/chat/agentRuntime.ts: initAgentRuntimeWithUserPayload` on server
   * - `src/services/chat.ts: initializeWithClientStore` on client
   */
  static initializeWithProvider(
    provider: string,
    params: Partial<
      ClientOptions &
        LobeBedrockAIParams &
        LobeCloudflareParams & {
          apiKey?: string;
          apiVersion?: string;
          baseURL?: string;
          userId?: string;
        }
    >,
    hooks?: ModelRuntimeHooks,
  ) {
    // @ts-expect-error runtime map not include vertex so it will be undefined
    const providerAI = providerRuntimeMap[provider] ?? LobeOpenAI;

    const runtimeModel: LobeRuntimeAI = new providerAI(params);

    return new ModelRuntime(runtimeModel, hooks);
  }
}
