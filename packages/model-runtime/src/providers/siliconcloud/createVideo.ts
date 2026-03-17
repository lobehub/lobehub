import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';

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

async function queryVideoStatus(
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
  log('Video task created with id: %s, starting polling...', inferenceId);

  const result = await asyncifyPolling<SiliconCloudVideoStatusResponse, CreateVideoResponse>({
    checkStatus: (
      statusResponse: SiliconCloudVideoStatusResponse,
    ): TaskResult<CreateVideoResponse> => {
      log('Task %s status: %s', inferenceId, statusResponse.status);

      if (statusResponse.status === 'Succeed') {
        const videoUrl = statusResponse.results?.videos?.[0]?.url;
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

      if (statusResponse.status === 'Failed') {
        const errorMessage =
          statusResponse.reason || statusResponse.error?.message || 'Video generation failed';
        log('Video generation failed: %s, error: %s', inferenceId, errorMessage);

        return {
          error: new Error(errorMessage),
          status: 'failed',
        };
      }

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
