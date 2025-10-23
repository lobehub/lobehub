import type { TracePayload } from '@lobechat/types';
import { ClientOptions } from 'openai';

import { LobeBedrockAIParams } from '../providers/bedrock';
import { LobeCloudflareParams } from '../providers/cloudflare';
import { LobeOpenAI } from '../providers/openai';
import { providerRuntimeMap } from '../runtimeMap';
import {
  ChatMethodOptions,
  ChatStreamPayload,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectPayload,
  ModelRequestOptions,
  PullModelParams,
  TextToImagePayload,
  TextToSpeechPayload,
} from '../types';
import { AuthenticatedImageRuntime, CreateImagePayload } from '../types/image';
import { LobeRuntimeAI } from './BaseAI';

export interface AgentChatOptions {
  enableTrace?: boolean;
  provider: string;
  trace?: TracePayload;
}

export class ModelRuntime {
  private _runtime: LobeRuntimeAI;

  constructor(runtime: LobeRuntimeAI) {
    this._runtime = runtime;
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
    return this._runtime.chat!(payload, options);
  }

  async generateObject(payload: GenerateObjectPayload) {
    return this._runtime.generateObject!(payload);
  }

  async textToImage(payload: TextToImagePayload) {
    return this._runtime.textToImage?.(payload);
  }

  async createImage(payload: CreateImagePayload) {
    return this._runtime.createImage?.(payload);
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
  ) {
    // @ts-expect-error runtime map not include vertex so it will be undefined
    const providerAI = providerRuntimeMap[provider] ?? LobeOpenAI;

    const runtimeModel: LobeRuntimeAI = new providerAI(params);

    return new ModelRuntime(runtimeModel);
  }
}
