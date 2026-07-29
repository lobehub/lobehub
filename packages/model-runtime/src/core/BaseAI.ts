import type { AIBaseModelCard } from 'model-bank';
import type OpenAI from 'openai';

import type {
  ASROptions,
  ASRPayload,
  ASRResponse,
  ChatMethodOptions,
  ChatStreamPayload,
  CreateImageMethodOptions,
  CreateImagePayload,
  CreateImageResponse,
  CreateVideoMethodOptions,
  CreateVideoPayload,
  CreateVideoResult,
  Embeddings,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  HandleCreateVideoWebhookPayload,
  HandleCreateVideoWebhookResult,
  ModelRequestOptions,
  PollVideoStatusResult,
  PullModelParams,
  TextToSpeechOptions,
  TextToSpeechPayload,
  VideoGenerationCapabilities,
  VideoPollingRoute,
} from '../types';

export interface LobeRuntimeAI {
  baseURL?: string;
  chat?: (payload: ChatStreamPayload, options?: ChatMethodOptions) => Promise<Response>;
  createImage?: (
    payload: CreateImagePayload,
    options?: CreateImageMethodOptions,
  ) => Promise<CreateImageResponse>;

  createVideo?: (
    payload: CreateVideoPayload,
    options?: CreateVideoMethodOptions,
  ) => Promise<CreateVideoResult>;

  embeddings?: (payload: EmbeddingsPayload, options?: EmbeddingsOptions) => Promise<Embeddings[]>;

  generateObject?: (
    payload: GenerateObjectPayload,
    options?: GenerateObjectOptions,
  ) => Promise<any>;

  getVideoGenerationCapabilities?: (model: string) => VideoGenerationCapabilities;

  handleCreateVideoWebhook?: (
    payload: HandleCreateVideoWebhookPayload,
  ) => Promise<HandleCreateVideoWebhookResult>;

  handlePollVideoStatus?: (
    inferenceId: string,
    model?: string,
    route?: VideoPollingRoute,
  ) => Promise<PollVideoStatusResult>;

  models?: () => Promise<any>;

  /**
   * Composite runtimes set this when they resolve completion mode inside their selected route.
   */
  orchestratesVideoGenerationCompletion?: boolean;

  // Model management related interface
  pullModel?: (params: PullModelParams, options?: ModelRequestOptions) => Promise<Response>;

  textToSpeech?: (
    payload: TextToSpeechPayload,
    options?: TextToSpeechOptions,
  ) => Promise<ArrayBuffer>;

  transcribe?: (payload: ASRPayload, options?: ASROptions) => Promise<ASRResponse>;
}
/* eslint-enabled */

export abstract class LobeOpenAICompatibleRuntime {
  abstract baseURL: string;
  abstract client: OpenAI;

  abstract chat(payload: ChatStreamPayload, options?: ChatMethodOptions): Promise<Response>;
  abstract createImage(payload: CreateImagePayload): Promise<CreateImageResponse>;
  abstract generateObject(
    payload: GenerateObjectPayload,
    options?: GenerateObjectOptions,
  ): Promise<Record<string, any>>;

  abstract models(): Promise<AIBaseModelCard[]>;

  abstract embeddings(
    payload: EmbeddingsPayload,
    options?: EmbeddingsOptions,
  ): Promise<Embeddings[]>;

  transcribe?(payload: ASRPayload, options?: ASROptions): Promise<ASRResponse>;

  textToSpeech?(payload: TextToSpeechPayload, options?: TextToSpeechOptions): Promise<ArrayBuffer>;
}
