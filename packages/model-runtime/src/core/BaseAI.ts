import type { AIBaseModelCard } from 'model-bank';
import type OpenAI from 'openai';

import type {
  ChatMethodOptions,
  ChatStreamPayload,
  CreateImageMethodOptions,
  CreateImagePayload,
  CreateImageResponse,
  CreateVideoMethodOptions,
  CreateVideoPayload,
  CreateVideoResponse,
  Embeddings,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  HandleCreateVideoWebhookPayload,
  HandleCreateVideoWebhookResult,
  ModelRequestOptions,
  PullModelParams,
  TextToSpeechOptions,
  TextToSpeechPayload,
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
  ) => Promise<CreateVideoResponse>;

  embeddings?: (payload: EmbeddingsPayload, options?: EmbeddingsOptions) => Promise<Embeddings[]>;

  generateObject?: (
    payload: GenerateObjectPayload,
    options?: GenerateObjectOptions,
  ) => Promise<any>;

  handleCreateVideoWebhook?: (
    payload: HandleCreateVideoWebhookPayload,
  ) => Promise<HandleCreateVideoWebhookResult>;

  handlePollVideoStatus?: (
    inferenceId: string,
  ) => Promise<
    | { status: 'success'; videoUrl: string }
    | { status: 'failed'; error: string }
    | { status: 'pending' }
  >;

  models?: () => Promise<any>;

  // Model management related interface
  pullModel?: (params: PullModelParams, options?: ModelRequestOptions) => Promise<Response>;

  textToSpeech?: (
    payload: TextToSpeechPayload,
    options?: TextToSpeechOptions,
  ) => Promise<ArrayBuffer>;
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
}
