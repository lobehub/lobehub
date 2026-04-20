import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';

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
export async function queryWenxinVideoStatus(
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
 * Poll video status and return standardized result
 */
export async function pollWenxinVideoStatus(
  task_id: string,
  options: { apiKey: string; baseURL: string },
): Promise<
  | { status: 'success'; videoUrl: string }
  | { status: 'failed'; error: string }
  | { status: 'pending' }
> {
  const response = await queryWenxinVideoStatus(task_id, options);

  if (response.status === 'succeeded') {
    const videoUrl = response.content?.video_url;
    if (!videoUrl) {
      return { error: 'Task succeeded but no video URL found', status: 'failed' };
    }
    return { status: 'success', videoUrl };
  }

  if (response.status === 'failed') {
    return { error: 'Video generation failed', status: 'failed' };
  }

  return { status: 'pending' };
}

/**
 * Wenxin video generation implementation
 * API docs: https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Blf7thw8d
 *
 * Creates a video generation task and returns immediately with inferenceId.
 * The frontend polls the task status using async task polling mechanism.
 */
export async function createWenxinVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, aspectRatio, duration, generateAudio, promptExtend, watermark } =
    params;

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
  if (promptExtend) body.prompt_extend = promptExtend;
  if (watermark) body.watermark = watermark;

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
  log('Video task created with task_id: %s, returning immediately for frontend polling', taskId);

  // Return immediately with inferenceId only
  // Frontend will poll the task status using the async task polling mechanism
  // This avoids blocking the API response for 30+ seconds during server-side polling
  return { inferenceId: taskId };
}
