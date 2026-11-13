import { AgentRuntimeErrorType } from '@lobechat/types';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import type { CreateMusicOptions, CreateMusicPayload } from '../../types/music';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { trimTrailingSlashes } from '../../utils/trimTrailingSlashes';
import { createSunoMusic, DEFAULT_SUNO_BASE_URL, pollSunoMusicStatus } from './createMusic';

const SUNO_PROVIDER_ID = 'suno';

export interface LobeSunoAIParams extends ModelIdMappingOptions {
  apiKey?: string;
  baseURL?: string | null;
  /** Provider id for error payloads; custom providers pass their own id. */
  id?: string;
}

/**
 * Suno is music-only, so the runtime implements `createMusic` and its task polling alone;
 * chat, image and other calls resolve to `undefined` through `ModelRuntime`.
 */
export class LobeSunoAI implements LobeRuntimeAI {
  baseURL: string;
  private apiKey: string;
  private id: string;
  private modelIdMapping?: ModelIdMappingOptions['modelIdMapping'];

  constructor({ apiKey, baseURL, id, modelIdMapping }: LobeSunoAIParams = {}) {
    if (!apiKey?.trim())
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.apiKey = apiKey.trim();
    this.baseURL = trimTrailingSlashes(baseURL || DEFAULT_SUNO_BASE_URL);
    this.id = id || SUNO_PROVIDER_ID;
    this.modelIdMapping = modelIdMapping;
  }

  createMusic(payload: CreateMusicPayload, options?: CreateMusicOptions) {
    return createSunoMusic(payload, {
      ...options,
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      modelIdMapping: this.modelIdMapping,
      provider: this.id,
    });
  }

  handlePollMusicStatus(inferenceId: string) {
    return pollSunoMusicStatus(inferenceId, {
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      provider: this.id,
    });
  }
}

export default LobeSunoAI;
