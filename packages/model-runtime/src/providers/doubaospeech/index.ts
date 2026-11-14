import { AgentRuntimeErrorType } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import type { TextToSpeechOptions, TextToSpeechPayload } from '../../types/tts';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import type { DoubaoSpeechCredentials } from './createSpeech';
import {
  buildDoubaoSpeechAuthHeaders,
  createDoubaoSpeech,
  DOUBAO_SPEECH_MISSING_CREDENTIALS_MESSAGE,
  normalizeDoubaoSpeechBaseURL,
} from './createSpeech';

export interface LobeDoubaoSpeechAIParams extends DoubaoSpeechCredentials, ModelIdMappingOptions {
  baseURL?: string | null;
  /** Provider id for pricing and error payloads; custom providers pass their own id. */
  id?: string;
}

/**
 * Doubao Speech is text-to-speech only, so the runtime implements `textToSpeech` alone;
 * chat, image and other calls resolve to `undefined` through `ModelRuntime`.
 */
export class LobeDoubaoSpeechAI implements LobeRuntimeAI {
  baseURL: string;
  private credentials: DoubaoSpeechCredentials;
  private id: string;
  private modelIdMapping?: ModelIdMappingOptions['modelIdMapping'];

  constructor({
    accessToken,
    apiKey,
    appId,
    baseURL,
    id,
    modelIdMapping,
  }: LobeDoubaoSpeechAIParams = {}) {
    const credentials = { accessToken, apiKey, appId };
    // Says which credentials are missing, e.g. an App ID saved without its Access Token.
    if (!buildDoubaoSpeechAuthHeaders(credentials))
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey, {
        message: DOUBAO_SPEECH_MISSING_CREDENTIALS_MESSAGE,
      });

    this.credentials = credentials;
    this.baseURL = normalizeDoubaoSpeechBaseURL(baseURL);
    this.id = id || ModelProvider.DoubaoSpeech;
    this.modelIdMapping = modelIdMapping;
  }

  textToSpeech(payload: TextToSpeechPayload, options?: TextToSpeechOptions) {
    return createDoubaoSpeech(payload, {
      ...options,
      ...this.credentials,
      baseURL: this.baseURL,
      modelIdMapping: this.modelIdMapping,
      provider: this.id,
    });
  }
}

export default LobeDoubaoSpeechAI;
