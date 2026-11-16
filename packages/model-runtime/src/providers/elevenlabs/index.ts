import { AgentRuntimeErrorType } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import type { TextToSpeechOptions, TextToSpeechPayload } from '../../types/tts';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { createElevenLabsSpeech, normalizeElevenLabsBaseURL } from './createSpeech';

export interface LobeElevenLabsAIParams extends ModelIdMappingOptions {
  apiKey?: string;
  baseURL?: string | null;
  /** Provider id for pricing and error payloads; custom providers pass their own id. */
  id?: string;
}

/**
 * ElevenLabs is text-to-speech only, so the runtime implements `textToSpeech` alone; chat,
 * image and other calls resolve to `undefined` through `ModelRuntime`.
 */
export class LobeElevenLabsAI implements LobeRuntimeAI {
  baseURL: string;
  private apiKey: string;
  private id: string;
  private modelIdMapping?: ModelIdMappingOptions['modelIdMapping'];

  constructor({ apiKey, baseURL, id, modelIdMapping }: LobeElevenLabsAIParams = {}) {
    if (!apiKey?.trim())
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.apiKey = apiKey.trim();
    this.baseURL = normalizeElevenLabsBaseURL(baseURL);
    this.id = id || ModelProvider.ElevenLabs;
    this.modelIdMapping = modelIdMapping;
  }

  textToSpeech(payload: TextToSpeechPayload, options?: TextToSpeechOptions) {
    return createElevenLabsSpeech(payload, {
      ...options,
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      modelIdMapping: this.modelIdMapping,
      provider: this.id,
    });
  }
}

export default LobeElevenLabsAI;
