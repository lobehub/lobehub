import type { TracePayload } from '@lobechat/types';
import type { ClientOptions } from 'openai';

import type { LobeBedrockAIParams } from '../providers/bedrock';
import type { LobeCloudflareParams } from '../providers/cloudflare';
import { LobeOpenAI } from '../providers/openai';
import { providerRuntimeMap } from '../runtimeMap';
import type {
  ChatMethodOptions,
  ChatStreamPayload,
  EmbeddingsOptions,
  EmbeddingsPayload,
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
  /**
   * Called after the stream completes. ModelRuntime handles merging into onFinal internally.
   * Hook consumers only need to implement the callback — no need to deal with option merging.
   */
  onChatFinal?: (
    data: OnFinishData,
    context: { options?: ChatMethodOptions; payload: ChatStreamPayload },
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

    // Hook: beforeChat — budget check, etc.
    await this._hooks?.beforeChat?.(payload, options);

    // Hook: onChatFinal — inject only the onFinal callback without wrapping other callbacks
    // through mergeMultipleChatMethodOptions (which swallows errors via try/catch)
    let finalOptions = options;
    if (this._hooks?.onChatFinal) {
      const hookFn = this._hooks.onChatFinal;
      const existingOnFinal = options?.callback?.onFinal;
      finalOptions = {
        ...options,
        callback: {
          ...options?.callback,
          async onFinal(data) {
            await existingOnFinal?.(data);
            hookFn(data, { options, payload });
          },
        },
      };
    }

    return this._runtime.chat(payload, finalOptions);
  }

  async generateObject(payload: GenerateObjectPayload) {
    return this._runtime.generateObject!(payload);
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
    return this._runtime.embeddings?.(payload, options);
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
        LobeCloudflareParams & { apiKey?: string; apiVersion?: string; baseURL?: string }
    >,
    hooks?: ModelRuntimeHooks,
  ) {
    // @ts-expect-error runtime map not include vertex so it will be undefined
    const providerAI = providerRuntimeMap[provider] ?? LobeOpenAI;

    const runtimeModel: LobeRuntimeAI = new providerAI(params);

    return new ModelRuntime(runtimeModel, hooks);
  }
}
