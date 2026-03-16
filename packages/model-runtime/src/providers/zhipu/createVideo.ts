import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';

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
async function queryVideoStatus(
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
 * Zhipu video generation implementation with polling
 * API docs: https://docs.bigmodel.cn/cn/guide/paid-recommendation/cogvideox
 *
 * This function creates a video generation task and polls until completion,
 * similar to how createImage works (synchronous flow).
 */
export async function createZhipuVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, endImageUrl, aspectRatio, duration, generateAudio } = params;

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
  log('Video task created with id: %s, starting polling...', inferenceId);

  // Poll until video generation completes using asyncifyPolling (same pattern as qwen createImage)
  const result = await asyncifyPolling<ZhipuVideoStatusResponse, CreateVideoResponse>({
    checkStatus: (statusResponse: ZhipuVideoStatusResponse): TaskResult<CreateVideoResponse> => {
      log('Task %s status: %s', inferenceId, statusResponse.task_status);

      if (statusResponse.task_status === 'SUCCESS') {
        const videoUrl = statusResponse.video_result?.[0]?.url;
        if (!videoUrl) {
          return {
            error: new Error('Missing url in success response'),
            status: 'failed',
          };
        }
        log('Video generation succeeded: %s', inferenceId);

        return {
          data: { inferenceId, videoUrl },
          status: 'success',
        };
      }

      if (statusResponse.task_status === 'FAIL') {
        const errorMessage = statusResponse.error?.message || 'Video generation failed';
        log('Video generation failed: %s, error: %s', inferenceId, errorMessage);

        return {
          error: new Error(errorMessage),
          status: 'failed',
        };
      }

      // Continue polling for RUNNING, QUEUED, PENDING statuses
      log('Video generation in progress: %s (status: %s)', inferenceId, statusResponse.task_status);

      return { status: 'pending' };
    },
    logger: {
      debug: (message: any, ...args: any[]) => log(message, ...args),
      error: (message: any, ...args: any[]) => log(message, ...args),
    },
    pollingQuery: () => queryVideoStatus(inferenceId, { apiKey: options.apiKey, baseURL }),
  });

  log('Video generation completed, returning video URL');

  return result;
}
