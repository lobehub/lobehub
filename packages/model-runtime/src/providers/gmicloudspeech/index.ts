import { AgentRuntimeErrorType } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import type { TextToSpeechOptions, TextToSpeechPayload } from '../../types/tts';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { createGmicloudSpeech, normalizeGmicloudBaseURL } from './createSpeech';

export interface LobeGmicloudSpeechAIParams extends ModelIdMappingOptions {
  apiKey?: string;
  baseURL?: string | null;
  /** Provider id for pricing and error payloads; custom providers pass their own id. */
  id?: string;
}

/**
 * GMI Cloud Speech is text-to-speech only, so the runtime implements `textToSpeech`
 * alone; chat, image and other calls resolve to `undefined` through `ModelRuntime`.
 * Requests go through GMI Cloud's multimodal request queue (Inworld, MiniMax and
 * Chatterbox families), synchronous when the outcome is inline and polled otherwise.
 */
export class LobeGmicloudSpeechAI implements LobeRuntimeAI {
  baseURL: string;
  private apiKey: string;
  private id: string;
  private modelIdMapping?: ModelIdMappingOptions['modelIdMapping'];

  constructor({ apiKey, baseURL, id, modelIdMapping }: LobeGmicloudSpeechAIParams = {}) {
    if (!apiKey?.trim())
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.apiKey = apiKey.trim();
    this.baseURL = normalizeGmicloudBaseURL(baseURL);
    this.id = id || ModelProvider.GmicloudSpeech;
    this.modelIdMapping = modelIdMapping;
  }

  textToSpeech(payload: TextToSpeechPayload, options?: TextToSpeechOptions) {
    return createGmicloudSpeech(payload, {
      ...options,
      apiKey: this.apiKey,      baseURL: this.baseURL,
      modelIdMapping: this.modelIdMapping,
      provider: this.id,
    });
  }
}

export default LobeGmicloudSpeechAI;
