import createDebug from 'debug';

import type {
  WaveSpeedCreateOptions,
  WaveSpeedPredictionResponse,
  WaveSpeedSubmitResponse,
} from './types';
import { WAVESPEED_DEFAULT_BASE_URL } from './types';

const log = createDebug('lobe-wavespeed:api');

/**
 * Channel attribution, per WaveSpeed's client convention. It lets WaveSpeed
 * attribute traffic to LobeHub and has no effect on the generation itself.
 */
const CLIENT_NAME = 'lobehub';

export const buildHeaders = (apiKey: string): Record<string, string> => ({
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'X-Client-Name': CLIENT_NAME,
});

const resolveBaseURL = (baseURL?: string) =>
  (baseURL || WAVESPEED_DEFAULT_BASE_URL).replace(/\/+$/, '');

const parseErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = await response.json();
    return body?.message || body?.error || response.statusText;
  } catch {
    return response.statusText;
  }
};

/**
 * Submit a prediction.
 *
 * IMPORTANT: this request must never be retried. WaveSpeed bills per accepted
 * prediction, so a retry after an ambiguous failure would create — and charge
 * for — a second task. Only the polling GET below is safe to retry.
 */
export const submitTask = async (
  model: string,
  body: Record<string, unknown>,
  options: WaveSpeedCreateOptions,
): Promise<string> => {
  const url = `${resolveBaseURL(options.baseURL)}/api/v3/${model}`;

  log('Submitting task to %s with body %O', url, body);

  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: buildHeaders(options.apiKey),
    method: 'POST',
  });

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    const error = new Error(`WaveSpeed API error (${response.status}): ${message}`);
    // Surface the status so the runtime can map 401 to InvalidProviderAPIKey.
    Object.assign(error, { status: response.status });
    throw error;
  }

  const payload = (await response.json()) as WaveSpeedSubmitResponse;
  const id = payload?.data?.id;

  if (!id) throw new Error('WaveSpeed API did not return a prediction id');

  log('Task submitted with prediction id %s', id);

  return id;
};

/**
 * Fetch the current state of a prediction. Safe to retry.
 */
export const queryTask = async (
  predictionId: string,
  options: WaveSpeedCreateOptions,
): Promise<WaveSpeedPredictionResponse> => {
  const url = `${resolveBaseURL(options.baseURL)}/api/v3/predictions/${predictionId}/result`;

  const response = await fetch(url, {
    headers: buildHeaders(options.apiKey),
    method: 'GET',
  });

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    const error = new Error(
      `WaveSpeed API error while polling prediction ${predictionId} (${response.status}): ${message}`,
    );
    Object.assign(error, { status: response.status });
    throw error;
  }

  return (await response.json()) as WaveSpeedPredictionResponse;
};
