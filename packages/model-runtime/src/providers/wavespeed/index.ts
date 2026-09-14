import createDebug from 'debug';
import type { ClientOptions } from 'openai';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import { AgentRuntimeErrorType } from '../../types/error';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import type {
  CreateVideoPayload,
  CreateVideoResponse,
  PollVideoStatusResult,
} from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';
import { createWaveSpeedImage } from './createImage';
import { createWaveSpeedVideo, pollWaveSpeedVideoStatus } from './createVideo';
import type { WaveSpeedCreateOptions } from './types';

const log = createDebug('lobe-wavespeed');

const PROVIDER = 'wavespeed';

export class LobeWaveSpeedAI implements LobeRuntimeAI {
  private apiKey: string;
  baseURL?: string;

  // OpenAI SDK v6 widened `apiKey` to `string | ApiKeySetter`; lobehub only uses the string form.
  constructor({ apiKey, baseURL }: Omit<ClientOptions, 'apiKey'> & { apiKey?: string } = {}) {
    if (!apiKey) throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.apiKey = apiKey;
    this.baseURL = baseURL || undefined;

    log('WaveSpeed AI initialized');
  }

  private get options(): WaveSpeedCreateOptions {
    return { apiKey: this.apiKey, baseURL: this.baseURL, provider: PROVIDER };
  }

  async createImage(payload: CreateImagePayload): Promise<CreateImageResponse> {
    log('Creating image with model: %s and params: %O', payload.model, payload.params);

    return createWaveSpeedImage(payload, this.options);
  }

  async createVideo(payload: CreateVideoPayload): Promise<CreateVideoResponse> {
    log('Creating video with model: %s and params: %O', payload.model, payload.params);

    return createWaveSpeedVideo(payload, this.options);
  }

  async handlePollVideoStatus(inferenceId: string): Promise<PollVideoStatusResult> {
    return pollWaveSpeedVideoStatus(inferenceId, this.options);
  }
}
