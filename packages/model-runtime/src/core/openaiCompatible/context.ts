import type OpenAI from 'openai';

import type { ChatCompletionErrorPayload } from '../../types';
import type { SignatureScope, SignatureScopeKind } from '../../utils/signatureScope';
import type { ShouldUseResponsesAPIParams } from './apiMode';
import type { ConstructorOptions, ResponseCreateParamsWithPromptCacheKey } from './factoryOptions';

/**
 * What the protocol modules read from a factory-built runtime. The runtime builds it per
 * call, so its own members stay private and subclasses keep overriding `handleError`.
 */
export interface OpenAICompatibleRuntimeContext {
  _options: ConstructorOptions;
  baseURL: string;
  client: OpenAI;
  getMappedModelId: (model: string) => string;
  getSignatureScope: (
    model: string,
    kind: SignatureScopeKind,
    protocol: 'chat_completions' | 'responses',
  ) => Promise<SignatureScope | undefined>;
  handleError: (error: unknown) => ChatCompletionErrorPayload;
  id: string;
  /** The runtime itself, passed through to `customClient.createChatCompletionStream`. */
  instance: unknown;
  logPrefix: string;
  prepareResponsesRequest: (
    payload: ResponseCreateParamsWithPromptCacheKey,
    logicalModel: string,
  ) => { headers?: Record<string, string>; payload: ResponseCreateParamsWithPromptCacheKey };
  resolvePromptCacheKeyParams: (
    model?: string,
    user?: string,
    existingPromptCacheKey?: string,
  ) => { prompt_cache_key?: string };
  shouldUseResponsesAPI: (params: ShouldUseResponsesAPIParams) => boolean;
  withMappedRequestModel: <TPayload extends { model?: string }>(
    requestPayload: TPayload,
    logicalModel: string,
  ) => TPayload;
}
