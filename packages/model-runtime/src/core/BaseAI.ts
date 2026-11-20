import type { AIBaseModelCard } from 'model-bank';
import type OpenAI from 'openai';

import type {
  ASROptions,
  ASRPayload,
  ASRResponse,
  ChatMethodOptions,
  ChatStreamPayload,
  CheckCredentialsResult,
  CreateImageMethodOptions,
  CreateImagePayload,
  CreateImageResponse,
  CreateMusicOptions,
  CreateMusicPayload,
  CreateMusicResult,
  CreateVideoMethodOptions,
  CreateVideoPayload,
  CreateVideoResult,
  DecisionOptions,
  DecisionPayload,
  DecisionQuestions,
  DecisionResponse,
  Embeddings,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  HandleCreateVideoWebhookPayload,
  HandleCreateVideoWebhookResult,
  ModelRequestOptions,
  MusicPollingRoute,
  PollMusicStatusOptions,
  PollMusicStatusResult,
  PollVideoStatusResult,
  PullModelParams,
  TextToSpeechOptions,
  TextToSpeechPayload,
  TextToSpeechResponse,
  VideoGenerationCapabilities,
  VideoPollingRoute,
} from '../types';

export interface LobeRuntimeAI {
  baseURL?: string;
  chat?: (payload: ChatStreamPayload, options?: ChatMethodOptions) => Promise<Response>;

  /**
   * Verify the configured key without generating anything (e.g. a balance endpoint).
   * Used by the provider settings checker for providers that serve no chat model
   * (`settings.checkMode: 'credentials'`). Throws an `AgentRuntimeError` on a rejected key.
   */
  checkCredentials?: () => Promise<CheckCredentialsResult>;

  createImage?: (
    payload: CreateImagePayload,
    options?: CreateImageMethodOptions,
  ) => Promise<CreateImageResponse>;

  /**
   * Generate a song. Synchronous providers return `success` with tracks; asynchronous ones
   * return `pending` with a task id unless `options.waitForCompletion` is set.
   */
  createMusic?: (
    payload: CreateMusicPayload,
    options?: CreateMusicOptions,
  ) => Promise<CreateMusicResult>;

  createVideo?: (
    payload: CreateVideoPayload,
    options?: CreateVideoMethodOptions,
  ) => Promise<CreateVideoResult>;

  /**
   * Answer typed questions with probabilities through a decision model.
   * Only implemented by providers that serve decision models.
   */
  decide?: <Q extends DecisionQuestions>(
    payload: DecisionPayload<Q>,
    options?: DecisionOptions,
  ) => Promise<DecisionResponse<Q>>;

  embeddings?: (payload: EmbeddingsPayload, options?: EmbeddingsOptions) => Promise<Embeddings[]>;

  generateObject?: (
    payload: GenerateObjectPayload,
    options?: GenerateObjectOptions,
  ) => Promise<any>;

  getVideoGenerationCapabilities?: (model: string) => VideoGenerationCapabilities;

  handleCreateVideoWebhook?: (
    payload: HandleCreateVideoWebhookPayload,
  ) => Promise<HandleCreateVideoWebhookResult>;

  /** Query an asynchronous music task once, for `createMusic` results that are `pending`. */
  handlePollMusicStatus?: (
    inferenceId: string,
    model?: string,
    route?: MusicPollingRoute,
    options?: PollMusicStatusOptions,
  ) => Promise<PollMusicStatusResult>;

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
  ) => Promise<TextToSpeechResponse>;

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

  textToSpeech?(
    payload: TextToSpeechPayload,
    options?: TextToSpeechOptions,
  ): Promise<TextToSpeechResponse>;
}
