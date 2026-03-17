import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type {
  CreateVideoPayload,
  CreateVideoResponse,
  PollVideoStatusResult,
} from '../../types/video';

const log = createDebug('lobe-video:zhipu');

interface ZhipuVideoStatusResponse {
  error?: {
    code?: string;
    message?: string;
  };
  id?: string;
  request_id?: string;
  task_status?: string;
  video_result?: Array<{
    url?: string;
    cover_image_url?: string;
    watermarked_url?: string;
  }>;
}

/**
 * Query the status of a video generation task
 */
export async function queryZhipuVideoStatus(
  inferenceId: string,
  options: { apiKey: string; baseURL: string },
): Promise<ZhipuVideoStatusResponse> {
  const statusUrl = `${options.baseURL}/async-result/${inferenceId}`;

  log('Querying video status for: %s', inferenceId);

  const response = await fetch(statusUrl, {
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Zhipu status API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as ZhipuVideoStatusResponse;
  log('Video status response: %O', data);

  return data;
}

/**
 * Poll video status and return standardized result
 */
export async function pollZhipuVideoStatus(
  inferenceId: string,
  options: { apiKey: string; baseURL: string },
): Promise<PollVideoStatusResult> {
  const response = await queryZhipuVideoStatus(inferenceId, options);

  if (response.task_status === 'SUCCESS') {
    const videoUrl = response.video_result?.[0]?.url;
    if (!videoUrl) {
      return { error: 'Task succeeded but no video URL found', status: 'failed' };
    }
    return { status: 'success', videoUrl };
  }

  if (response.task_status === 'FAIL') {
    return { error: response.error?.message || 'Video generation failed', status: 'failed' };
  }

  return { status: 'pending' };
}

/**
 * Zhipu video generation implementation
 * API docs: https://docs.bigmodel.cn/cn/guide/paid-recommendation/cogvideox
 *
 * Creates a video generation task and returns immediately with inferenceId.
 * The frontend polls the task status using async task polling mechanism.
 */
export async function createZhipuVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, endImageUrl, aspectRatio, duration, generateAudio, size } = params;

  log('Creating video with Zhipu API - model: %s, params: %O', model, params);

  const baseURL = options.baseURL || 'https://open.bigmodel.cn/api/paas/v4';

  // Build request body based on Zhipu CogVideoX API format
  const body: Record<string, unknown> = {
    model,
    prompt,
  };

  // Zhipu requires image_url as an array: [first_frame, last_frame?]
  // https://docs.bigmodel.cn/cn/guide/paid-recommendation/cogvideox
  const imageUrls: string[] = [];
  if (imageUrl) {
    imageUrls.push(imageUrl);
  }
  if (endImageUrl) {
    imageUrls.push(endImageUrl);
  }
  if (imageUrls.length > 0) {
    body.image_url = imageUrls;
  }

  // Add other optional parameters
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (duration) body.duration = duration;
  if (generateAudio !== undefined) body.with_audio = generateAudio;
  if (size) body.size = size;

  log('Zhipu video API request body: %O', body);

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
    log('Zhipu video API error: %s %s', response.status, errorText);
    throw new Error(`Zhipu video API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  log('Zhipu video API response: %O', data);

  if (!data?.id) {
    throw new Error('Invalid response: missing task id');
  }

  const inferenceId = data.id;
  log('Video task created with id: %s, returning immediately for frontend polling', inferenceId);

  // Return immediately with inferenceId only
  // Frontend will poll the task status using the async task polling mechanism
  // This avoids blocking the API response for 30+ seconds during server-side polling
  return { inferenceId };
}
