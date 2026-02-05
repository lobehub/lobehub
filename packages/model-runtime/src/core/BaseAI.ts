import type { AIBaseModelCard } from 'model-bank';
import type OpenAI from 'openai';

import type {
  ChatMethodOptions,
  ChatStreamPayload,
  CreateImagePayload,
  CreateImageResponse,
  Embeddings,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  ModelRequestOptions,
  PullModelParams,
  TextToSpeechOptions,
  TextToSpeechPayload,
} from '../types';

/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */
export interface LobeRuntimeAI {
  baseURL?: string;
  chat?: (payload: ChatStreamPayload, options?: ChatMethodOptions) => Promise<Response>;
  createImage?: (payload: CreateImagePayload) => Promise<CreateImageResponse>;

  embeddings?: (payload: EmbeddingsPayload, options?: EmbeddingsOptions) => Promise<Embeddings[]>;

  generateObject?: (
    payload: GenerateObjectPayload,
    options?: GenerateObjectOptions,
  ) => Promise<any>;

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
