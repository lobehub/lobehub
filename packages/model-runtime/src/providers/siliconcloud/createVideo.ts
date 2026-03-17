import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';

const log = createDebug('lobe-video:siliconcloud');

interface SiliconCloudVideoStatusResponse {
  error?: {
    code?: string;
    message?: string;
  };
  reason?: string;
  requestId?: string;
  results?: {
    videos?: Array<{
      url?: string;
    }>;
    timings?: {
      inference: number;
    };
    seed?: number;
  };
  status?: string;
}

/**
 * Query the status of a video generation task
 */
export async function querySiliconCloudVideoStatus(
  requestId: string,
  options: { apiKey: string; baseURL: string },
): Promise<SiliconCloudVideoStatusResponse> {
  const statusUrl = `${options.baseURL}/video/status`;

  log('Querying video status for: %s', requestId);

  const response = await fetch(statusUrl, {
    body: JSON.stringify({ requestId }),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SiliconCloud status API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as SiliconCloudVideoStatusResponse;
  log('Video status response: %O', data);

  return data;
}

/**
 * Poll video status and return standardized result
 */
export async function pollSiliconCloudVideoStatus(
  requestId: string,
  options: { apiKey: string; baseURL: string },
): Promise<
  | { status: 'success'; videoUrl: string }
  | { status: 'failed'; error: string }
  | { status: 'pending' }
> {
  const response = await querySiliconCloudVideoStatus(requestId, options);

  if (response.status === 'Succeed') {
    const videoUrl = response.results?.videos?.[0]?.url;
    if (!videoUrl) {
      return { error: 'Task succeeded but no video URL found', status: 'failed' };
    }
    return { status: 'success', videoUrl };
  }

  if (response.status === 'Failed') {
    return {
      error: response.reason || response.error?.message || 'Video generation failed',
      status: 'failed',
    };
  }

  return { status: 'pending' };
}

/**
 * SiliconCloud video generation implementation
 *
 * Creates a video generation task and returns immediately with inferenceId.
 * The frontend polls the task status using async task polling mechanism.
 */
export async function createSiliconCloudVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, size, seed } = params;

  log('Creating video with SiliconCloud API - model: %s, params: %O', model, params);

  const baseURL = options.baseURL || 'https://api.siliconflow.cn/v1';

  const body: Record<string, unknown> = {
    model,
    prompt,
  };

  if (size) {
    body['image_size'] = size;
  }

  if (seed !== undefined && seed !== null) body['seed'] = seed;

  if (imageUrl) {
    body['image'] = imageUrl;
  }

  log('SiliconCloud video API request body: %O', body);

  const response = await fetch(`${baseURL}/video/submit`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('SiliconCloud video API error: %s %s', response.status, errorText);
    throw new Error(`SiliconCloud video API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  log('SiliconCloud video API response: %O', data);

  if (!data?.requestId) {
    throw new Error('Invalid response: missing requestId');
  }

  const inferenceId = data.requestId;
  log('Video task created with id: %s, returning immediately for frontend polling', inferenceId);

  // Return immediately with inferenceId only
  // Frontend will poll the task status using the async task polling mechanism
  // This avoids blocking the API response for 30+ seconds during server-side polling
  return { inferenceId };
}
