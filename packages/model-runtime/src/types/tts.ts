import type { ModelUsage } from '@lobechat/types';
import type { RuntimeTTSParams, TTSAudioFormat } from 'model-bank';

import type { ModelPricingContext } from './pricing';
import type { OnUsageCallback } from './routeAttempt';

export interface TextToSpeechPayload {
  input: string;
  model: string;
  /**
   * Standard TTS parameters; see `TTSModelParamsMetaSchema` in model-bank for what each
   * model declares. Providers map them onto their own request shape.
   */
  params?: RuntimeTTSParams;
  /**
   * @deprecated Use `params.speed`. Still read when `params.speed` is absent.
   */
  speed?: number;
  voice: string;
  /**
   * True when the caller gave no voice and `voice` is the model card default. Providers
   * may then substitute a voice the account can use; an explicit voice is never replaced.
   */
  voiceIsDefault?: boolean;
}

export interface TextToSpeechOptions {
  headers?: Record<string, any>;
  /** Metadata passed to hooks (billing, tracing, route attempts), e.g. `trigger`. */
  metadata?: Record<string, unknown>;
  /**
   * Receives the synthesis usage (with `cost` when the model has pricing) after a
   * successful request.
   */
  onUsage?: OnUsageCallback;
  pricingContext?: ModelPricingContext;
  signal?: AbortSignal;
  /**
   * userId for the request
   */
  user?: string;
}

export interface TextToSpeechResponse {
  audio: ArrayBuffer;
  format: TTSAudioFormat;
  /** Same value reported through `options.onUsage`; undefined when unknown. */
  usage?: ModelUsage;
}

/**
 * Merge the legacy top-level `speed` into the standard params; `params.speed` wins.
 */
export const resolveTextToSpeechParams = (payload: TextToSpeechPayload): RuntimeTTSParams => {
  const params = { ...payload.params };
  if (params.speed === undefined && payload.speed !== undefined) params.speed = payload.speed;

  return params;
};
