import createDebug from 'debug';

import type { CreateVideoOptions } from '../../../core/openaiCompatibleFactory';
import type {
  CreateVideoPayload,
  CreateVideoResponse,
  PollVideoStatusResult,
} from '../../../types/video';

const log = createDebug('lobe-video:volcengine');

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

/**
 * Whether to use webhook (callback_url) based async flow.
 *
 * Volcengine video generation defaults to a webhook callback: the server passes a
 * `callback_url` and waits for Volcengine to push the result. In self-hosted / internal
 * network deployments the callback endpoint may be unreachable (e.g. behind NAT / P2P),
 * so this can be switched off to fall back to server-side polling instead.
 *
 * Set `VOLCENGINE_VIDEO_USE_WEBHOOK=0` to disable webhook and use polling.
 * Defaults to webhook (backward compatible).
 */
const useWebhookFlow = () => process.env.VOLCENGINE_VIDEO_USE_WEBHOOK !== '0';

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
    imageUrls,
    endImageUrl,
    aspectRatio,
    duration,
    generateAudio,
    webSearch,
    watermark,
    seed,
    resolution,
    cameraFixed,
  } = params;

  log('Creating video with Volcengine API - model: %s, params: %O', model, params);

  const baseURL = options.baseURL || DEFAULT_BASE_URL;

  const withWebhook = useWebhookFlow();

  // Build content array
  const content: Record<string, unknown>[] = [{ text: prompt, type: 'text' }];

  if (imageUrl) {
    content.push({ image_url: { url: imageUrl }, role: 'first_frame', type: 'image_url' });
  }

  if (imageUrls && imageUrls.length > 0) {
    if (imageUrls.length === 1 && endImageUrl) {
      content.push({ image_url: { url: imageUrls[0] }, role: 'first_frame', type: 'image_url' });
    } else {
      imageUrls.forEach((url) =>
        content.push({ image_url: { url }, role: 'reference_image', type: 'image_url' }),
      );
    }
  }

  if (endImageUrl) {
    content.push({ image_url: { url: endImageUrl }, role: 'last_frame', type: 'image_url' });
  }

  // Build request body
  const body: Record<string, unknown> = {
    content,
    model,
    watermark: watermark ?? false,
    ...(webSearch && { tools: [{ type: 'web_search' }] }),
  };

  if (aspectRatio !== undefined) body.ratio = aspectRatio;
  if (duration !== undefined) body.duration = duration;
  if (generateAudio !== undefined) body.generate_audio = generateAudio;
  if (seed !== undefined && seed !== null) body.seed = seed;
  if (resolution !== undefined) body.resolution = resolution;
  if (cameraFixed !== undefined) body.camera_fixed = cameraFixed;
  // Only attach callback_url when webhook flow is enabled; otherwise the task
  // completes via server-side polling (see pollVolcengineVideoStatus).
  if (withWebhook && payload.callbackUrl) body.callback_url = payload.callbackUrl;

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

  // When webhook is disabled, omit `useWebhook` so the server falls back to
  // background polling via handlePollVideoStatus.
  return withWebhook
    ? { inferenceId: data.id, useWebhook: true }
    : { inferenceId: data.id };
}

interface VolcengineVideoTaskResponse {
  content?: {
    video_url?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
  id?: string;
  status?: string;
}

/**
 * Poll the status of a Volcengine video generation task.
 * Used when webhook flow is disabled (VOLCENGINE_VIDEO_USE_WEBHOOK=0).
 * API docs: https://www.volcengine.com/docs/82379/1521675
 */
export async function pollVolcengineVideoStatus(
  taskId: string,
  options: CreateVideoOptions,
): Promise<PollVideoStatusResult> {
  const baseURL = options.baseURL || DEFAULT_BASE_URL;

  log('Polling Volcengine video task status: %s', taskId);

  const response = await fetch(`${baseURL}/contents/generations/tasks/${taskId}`, {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('Volcengine video status API error: %s %s', response.status, errorText);
    throw new Error(`Volcengine video status API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as VolcengineVideoTaskResponse;

  log('Volcengine video task status response: %O', data);

  const status = data.status;

  if (status === 'succeeded') {
    const videoUrl = data.content?.video_url;
    if (!videoUrl) {
      return { error: 'Task succeeded but no video URL found', status: 'failed' };
    }
    return { status: 'success', videoUrl };
  }

  if (status === 'failed' || status === 'expired') {
    return {
      error:
        data.error?.message ||
        (status === 'expired' ? 'Video generation task expired' : 'Video generation failed'),
      status: 'failed',
    };
  }

  // queued / running / unknown -> keep polling
  return { status: 'pending' };
}
