import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';

const log = createDebug('lobe-video:wenxin');

interface WenxinVideoStatusResponse {
  content?: {
    video_url?: string;
  };
  created_at?: number;
  duration?: number;
  height?: number;
  id?: string;
  model?: string;
  status?: string;
  task_id?: string;
  updated_at?: number;
  width?: number;
}

/**
 * Query the status of a video generation task
 * API docs: https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Blf7thw8d
 */
async function queryVideoStatus(
  task_id: string,
  options: { apiKey: string; baseURL: string },
): Promise<WenxinVideoStatusResponse> {
  const statusUrl = `${options.baseURL}/video/generations?task_id=${task_id}`;

  log('Querying video status for task: %s', task_id);

  const response = await fetch(statusUrl, {
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wenxin status API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as WenxinVideoStatusResponse;
  log('Video status response: %O', data);

  return data;
}

/**
 * Wenxin video generation implementation with polling
 * API docs: https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Blf7thw8d
 *
 * This function creates a video generation task and polls until completion,
 * similar to how createImage works (synchronous flow).
 */
export async function createWenxinVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, aspectRatio, duration, generateAudio } = params;

  log('Creating video with Wenxin API - model: %s, params: %O', model, params);

  const baseURL = options.baseURL?.replace('/v2', '') || 'https://qianfan.baidubce.com';

  // Build content array based on Wenxin API format
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    {
      text: prompt,
      type: 'text',
    },
  ];

  // Add image if provided (for image-to-video)
  if (imageUrl) {
    content.push({
      image_url: {
        url: imageUrl,
      },
      type: 'image_url',
    });
  }

  // Build request body
  const body: Record<string, unknown> = {
    content,
    model,
  };

  // Add optional parameters based on Wenxin API
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (duration) body.duration = duration;
  if (generateAudio !== undefined) body.generate_audio = generateAudio;

  log('Wenxin video API request body: %O', body);

  const response = await fetch(`${baseURL}/video/generations`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('Wenxin video API error: %s %s', response.status, errorText);
    throw new Error(`Wenxin video API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  log('Wenxin video API response: %O', data);

  if (!data?.task_id) {
    throw new Error('Invalid response: missing task_id');
  }

  const taskId = data.task_id;
  log('Video task created with task_id: %s, starting polling...', taskId);

  // Poll until video generation completes using asyncifyPolling
  const result = await asyncifyPolling<WenxinVideoStatusResponse, CreateVideoResponse>({
    checkStatus: (statusResponse: WenxinVideoStatusResponse): TaskResult<CreateVideoResponse> => {
      log('Task %s status: %s', taskId, statusResponse.status);

      if (statusResponse.status === 'succeeded') {
        const videoUrl = statusResponse.content?.video_url;
        if (!videoUrl) {
          return {
            error: new Error('Missing video_url in success response'),
            status: 'failed',
          };
        }
        log('Video generation succeeded: %s', taskId);

        return {
          data: { inferenceId: statusResponse.task_id!, videoUrl },
          status: 'success',
        };
      }

      if (statusResponse.status === 'failed') {
        const errorMessage = 'Video generation failed';
        log('Video generation failed: %s', taskId);

        return {
          error: new Error(errorMessage),
          status: 'failed',
        };
      }

      // Continue polling for other statuses (pending, running, etc.)
      log('Video generation in progress: %s (status: %s)', taskId, statusResponse.status);

      return { status: 'pending' };
    },
    logger: {
      debug: (message: any, ...args: any[]) => log(message, ...args),
      error: (message: any, ...args: any[]) => log(message, ...args),
    },
    pollingQuery: () => queryVideoStatus(taskId, { apiKey: options.apiKey, baseURL }),
  });

  log('Video generation completed, returning video URL');

  return result;
}
