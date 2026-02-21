import createDebug from 'debug';

import { CreateVideoOptions } from '../../../core/openaiCompatibleFactory';
import { CreateVideoPayload, CreateVideoResponse } from '../../../types/video';

const log = createDebug('lobe-video:volcengine');

/**
 * Volcengine video generation implementation
 * API docs: https://www.volcengine.com/docs/232791/1399051
 */
export async function createVolcengineVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const {
    prompt,
    imageUrl,
    endImageUrl,
    aspectRatio,
    duration,
    generateAudio,
    seed,
    resolution,
    cameraFixed,
  } = params;

  log('Creating video with Volcengine API - model: %s, params: %O', model, params);

  const baseURL = options.baseURL || 'https://ark.cn-beijing.volces.com/api/v3';

  // Build content array
  const content: Record<string, unknown>[] = [{ text: prompt, type: 'text' }];

  if (imageUrl) {
    content.push({ image_url: { url: imageUrl }, role: 'first_frame', type: 'image_url' });
  }

  if (endImageUrl) {
    content.push({ image_url: { url: endImageUrl }, role: 'last_frame', type: 'image_url' });
  }

  // Build request body
  const body: Record<string, unknown> = {
    content,
    model,
    watermark: false,
  };

  if (aspectRatio !== undefined) body.ratio = aspectRatio;
  if (duration !== undefined) body.duration = duration;
  if (generateAudio !== undefined) body.generate_audio = generateAudio;
  if (seed !== undefined && seed !== null) body.seed = seed;
  if (resolution !== undefined) body.resolution = resolution;
  if (cameraFixed !== undefined) body.camera_fixed = cameraFixed;
  if (payload.callbackUrl) body.callback_url = payload.callbackUrl;

  log('Volcengine video API request body: %s', JSON.stringify(body, null, 2));

  const response = await fetch(`${baseURL}/contents/generations/tasks`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('Volcengine video API error: %s %s', response.status, errorText);
    throw new Error(`Volcengine video API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  log('Volcengine video API response: %O', data);

  if (!data?.id) {
    throw new Error('Invalid response: missing task id');
  }

  return { inferenceId: data.id };
}
