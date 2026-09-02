export const WAVESPEED_DEFAULT_BASE_URL = 'https://api.wavespeed.ai';

export interface WaveSpeedCreateOptions {
  apiKey: string;
  baseURL?: string;
  provider: string;
}

/**
 * Every WaveSpeed v3 response is wrapped in the same envelope.
 */
export interface WaveSpeedEnvelope<T> {
  code: number;
  data: T;
  message?: string | null;
}

export interface WaveSpeedSubmitData {
  id: string;
  model?: string;
  status?: WaveSpeedStatus;
}

/**
 * Terminal statuses are `completed`, `failed`, `cancelled` and `timeout`;
 * `created` and `processing` mean the prediction is still queued or running.
 */
export type WaveSpeedStatus =
  'created' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface WaveSpeedPredictionData {
  error?: string | null;
  executionTime?: number;
  has_nsfw_contents?: boolean[] | null;
  id: string;
  model?: string;
  outputs?: string[] | null;
  status: WaveSpeedStatus;
  timings?: Record<string, number> | null;
  urls?: { get?: string } | null;
}

export type WaveSpeedSubmitResponse = WaveSpeedEnvelope<WaveSpeedSubmitData>;
export type WaveSpeedPredictionResponse = WaveSpeedEnvelope<WaveSpeedPredictionData>;

export const WAVESPEED_FAILURE_STATUSES = new Set<WaveSpeedStatus>([
  'failed',
  'cancelled',
  'timeout',
]);

export const isWaveSpeedFailure = (status: WaveSpeedStatus): boolean =>
  WAVESPEED_FAILURE_STATUSES.has(status);
