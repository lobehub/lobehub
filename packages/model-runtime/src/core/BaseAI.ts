import { AIBaseModelCard } from 'model-bank';
import OpenAI from 'openai';

import {
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
  chat?(payload: ChatStreamPayload, options?: ChatMethodOptions): Promise<Response>;
  generateObject?(payload: GenerateObjectPayload, options?: GenerateObjectOptions): Promise<any>;

  embeddings?(payload: EmbeddingsPayload, options?: EmbeddingsOptions): Promise<Embeddings[]>;

  models?(): Promise<any>;

  createImage?: (payload: CreateImagePayload) => Promise<CreateImageResponse>;

  textToSpeech?: (
    payload: TextToSpeechPayload,
    options?: TextToSpeechOptions,
  ) => Promise<ArrayBuffer>;

  // Model management related interface
  pullModel?(params: PullModelParams, options?: ModelRequestOptions): Promise<Response>;
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
