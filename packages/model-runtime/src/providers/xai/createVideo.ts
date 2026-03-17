import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';

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

async function queryVideoStatus(
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

export async function createXAIVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, aspectRatio, duration, resolution } = params;

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
  log('Video task created with request_id: %s, starting polling...', requestId);

  const result = await asyncifyPolling<XAIVideoStatusResponse, CreateVideoResponse>({
    checkStatus: (statusResponse: XAIVideoStatusResponse): TaskResult<CreateVideoResponse> => {
      log('Task %s status: %s', requestId, statusResponse.status);

      if (statusResponse.status === 'done') {
        const videoUrl = statusResponse.video?.url;
        if (!videoUrl) {
          log('Task succeeded but missing video url in response');
          return {
            error: new Error('Missing url in success response'),
            status: 'failed',
          };
        }
        log('Video generation succeeded: %s, videoUrl: %s', requestId, videoUrl);

        return {
          data: { inferenceId: requestId, videoUrl },
          status: 'success',
        };
      }

      if (statusResponse.status === 'failed') {
        const errorMessage = statusResponse.error?.message || 'Video generation failed';
        log('Video generation failed: %s, error: %s', requestId, errorMessage);

        return {
          error: new Error(errorMessage),
          status: 'failed',
        };
      }

      log('Video generation in progress: %s (status: %s)', requestId, statusResponse.status);

      return { status: 'pending' };
    },
    initialInterval: 5000,
    logger: {
      debug: (message: any, ...args: any[]) => log(message, ...args),
      error: (message: any, ...args: any[]) => log(message, ...args),
    },
    maxInterval: 10000,
    maxRetries: 120,
    pollingQuery: () => queryVideoStatus(requestId, { apiKey: options.apiKey, baseURL }),
  });

  log('Video generation completed, returning video URL');

  return result;
}
