import { BRANDING_NAME, OFFICIAL_URL } from '@lobechat/const';
import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import { readProviderReportedCost } from '../../core/usageConverters/openai';
import type {
  CreateVideoPayload,
  CreateVideoResponse,
  PollVideoStatusResult,
} from '../../types/video';

const log = createDebug('lobe-video:openrouter');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

interface OpenRouterVideoJob {
  error?: { message?: string } | string | null;
  id?: string;
  status?: string;
  unsigned_urls?: string[] | null;
  url?: string | null;
  usage?: { cost?: number } | null;
}

const openRouterHeaders = (apiKey: string) => ({
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': OFFICIAL_URL,
  'X-Title': BRANDING_NAME,
});

const jobErrorMessage = (error: OpenRouterVideoJob['error']) => {
  if (!error) return 'Video generation failed';
  if (typeof error === 'string') return error;
  return error.message || 'Video generation failed';
};

const modelUsageFromJob = (data: OpenRouterVideoJob) => {
  const cost = readProviderReportedCost(data.usage);
  if (cost === undefined) return undefined;
  return { cost };
};

export const pollOpenRouterVideoStatus = async (
  inferenceId: string,
  options: { apiKey: string; baseURL?: string },
): Promise<PollVideoStatusResult> => {
  const baseURL = options.baseURL || DEFAULT_BASE_URL;
  const response = await fetch(`${baseURL}/videos/${inferenceId}`, {
    headers: openRouterHeaders(options.apiKey),
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('Video status API error %s: %s', response.status, errorText);
    throw new Error(`Video generation failed (${response.status})`);
  }

  const data = (await response.json()) as OpenRouterVideoJob;
  log('Video status response: %O', data);

  const status = (data.status || '').toLowerCase();
  if (status === 'completed') {
    // Always download via the OpenRouter content proxy. unsigned_urls often
    // point at provider CDNs (GCS, etc.) that fail with undici "fetch failed"
    // from networks where only openrouter.ai is reachable.
    const origin = baseURL.replace(/\/$/, '');
    const modelUsage = modelUsageFromJob(data);
    const costUsd = modelUsage?.cost;
    return {
      ...(typeof costUsd === 'number' ? { costUsd } : {}),
      headers: { Authorization: `Bearer ${options.apiKey}` },
      ...(modelUsage && { modelUsage }),
      status: 'success',
      videoUrl: `${origin}/videos/${inferenceId}/content`,
    };
  }

  if (status === 'failed' || status === 'cancelled' || status === 'expired') {
    return { error: jobErrorMessage(data.error), status: 'failed' };
  }

  return { status: 'pending' };
};

export const createOpenRouterVideo = async (
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> => {
  const { model, params } = payload;
  const { prompt, imageUrl, aspectRatio, duration, resolution, generateAudio } = params;
  const baseURL = options.baseURL || DEFAULT_BASE_URL;

  const body: Record<string, unknown> = {
    generate_audio: generateAudio ?? false,
    model,
    prompt,
  };
  if (typeof duration === 'number' && Number.isFinite(duration)) {
    body.duration = Math.round(duration);
  }
  if (resolution) body.resolution = resolution;
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (imageUrl) body.input_references = [imageUrl];

  log('Creating video with OpenRouter API - model: %s, params: %O', model, body);

  const response = await fetch(`${baseURL}/videos`, {
    body: JSON.stringify(body),
    headers: openRouterHeaders(options.apiKey),
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('Video API error %s: %s', response.status, errorText);
    throw new Error(`Video generation failed (${response.status})`);
  }

  const data = (await response.json()) as OpenRouterVideoJob;
  if (!data?.id) {
    throw new Error('Invalid response: missing id');
  }

  return { inferenceId: data.id };
};
