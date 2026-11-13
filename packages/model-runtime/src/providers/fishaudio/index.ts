import { AgentRuntimeErrorType } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import type { TextToSpeechOptions, TextToSpeechPayload } from '../../types/tts';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { createFishAudioSpeech, normalizeFishAudioBaseURL } from './createSpeech';

export interface LobeFishAudioAIParams extends ModelIdMappingOptions {
  apiKey?: string;
  baseURL?: string | null;
  /** Provider id for pricing and error payloads; custom providers pass their own id. */
  id?: string;
}

/**
 * Fish Audio is text-to-speech only, so the runtime implements `textToSpeech` alone; chat,
 * image and other calls resolve to `undefined` through `ModelRuntime`.
 */
export class LobeFishAudioAI implements LobeRuntimeAI {
  baseURL: string;
  private apiKey: string;
  private id: string;
  private modelIdMapping?: ModelIdMappingOptions['modelIdMapping'];

  constructor({ apiKey, baseURL, id, modelIdMapping }: LobeFishAudioAIParams = {}) {
    if (!apiKey?.trim())
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.apiKey = apiKey.trim();
    this.baseURL = normalizeFishAudioBaseURL(baseURL);
    this.id = id || ModelProvider.FishAudio;
    this.modelIdMapping = modelIdMapping;
  }

  textToSpeech(payload: TextToSpeechPayload, options?: TextToSpeechOptions) {
    return createFishAudioSpeech(payload, {
      ...options,
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      modelIdMapping: this.modelIdMapping,
      provider: this.id,
    });
  }
}

export default LobeFishAudioAI;
