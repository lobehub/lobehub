import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';

const log = createDebug('lobe-video:xai');

interface XAIVideoStatusResponse {
  error?: {
    code?: string;
    message?: string;
  };
  model?: string;
  status: 'processing' | 'done' | 'failed';
  video?: {
    duration?: number;
    respect_moderation?: boolean;
    url?: string;
  };
}

/**
 * Query the status of a video generation task
 */
export async function queryXAIVideoStatus(
  requestId: string,
  options: { apiKey: string; baseURL: string },
): Promise<XAIVideoStatusResponse> {
  const statusUrl = `${options.baseURL}/videos/${requestId}`;

  log('Querying video status for: %s', requestId);

  const response = await fetch(statusUrl, {
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`XAI status API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as XAIVideoStatusResponse;
  log('Video status response: %O', data);

  return data;
}

/**
 * Poll video status and return standardized result
 */
export async function pollXAIVideoStatus(
  requestId: string,
  options: { apiKey: string; baseURL: string },
): Promise<
  | { status: 'success'; videoUrl: string }
  | { status: 'failed'; error: string }
  | { status: 'pending' }
> {
  const response = await queryXAIVideoStatus(requestId, options);

  if (response.status === 'done') {
    const videoUrl = response.video?.url;
    if (!videoUrl) {
      return { error: 'Task succeeded but no video URL found', status: 'failed' };
    }
    return { status: 'success', videoUrl };
  }

  if (response.status === 'failed') {
    return { error: response.error?.message || 'Video generation failed', status: 'failed' };
  }

  return { status: 'pending' };
}

/**
 * XAI video generation implementation
 *
 * Creates a video generation task and returns immediately with inferenceId.
 * The frontend polls the task status using async task polling mechanism.
 */
export async function createXAIVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, aspectRatio, duration, resolution, size } = params;

  log('Creating video with XAI API - model: %s, params: %O', model, params);

  const baseURL = options.baseURL || 'https://api.x.ai/v1';

  const body: Record<string, unknown> = {
    model,
    prompt,
  };

  if (imageUrl) {
    body.image = { url: imageUrl };
  }

  if (aspectRatio) {
    body.aspect_ratio = aspectRatio;
  }

  if (duration) {
    body.duration = duration;
  }

  if (resolution) {
    body.resolution = resolution;
  }

  if (size) {
    body.size = size;
  }

  log('XAI video API request body: %O', body);

  const response = await fetch(`${baseURL}/videos/generations`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('XAI video API error: %s %s', response.status, errorText);
    throw new Error(`XAI video API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  log('XAI video API response: %O', data);

  if (!data?.request_id) {
    throw new Error('Invalid response: missing request_id');
  }

  const requestId = data.request_id;
  log(
    'Video task created with request_id: %s, returning immediately for frontend polling',
    requestId,
  );

  // Return immediately with inferenceId only
  // Frontend will poll the task status using the async task polling mechanism
  // This avoids blocking the API response for 30+ seconds during server-side polling
  return { inferenceId: requestId };
}
