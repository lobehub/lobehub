import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';

const log = createDebug('lobe-image:zhipu');

interface ZhipuImageStatusResponse {
  created?: number;
  data?: Array<{
    url?: string;
  }>;
  error?: {
    code?: string;
    message?: string;
  };
  id?: string;
  image_result?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  request_id?: string;
  task_status?: string;
}

export async function queryZhipuImageStatus(
  inferenceId: string,
  options: { apiKey: string; baseURL: string },
): Promise<ZhipuImageStatusResponse> {
  const statusUrl = `${options.baseURL}/async-result/${inferenceId}`;

  log('Querying image status for: %s', inferenceId);

  const response = await fetch(statusUrl, {
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Zhipu image status API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as ZhipuImageStatusResponse;
  log('Image status response: %O', data);

  return data;
}

export async function pollZhipuImageStatus(
  inferenceId: string,
  options: { apiKey: string; baseURL: string },
): Promise<CreateImageResponse> {
  return await asyncifyPolling<ZhipuImageStatusResponse, CreateImageResponse>({
    backoffMultiplier: 1,
    checkStatus: (taskStatus): TaskResult<CreateImageResponse> => {
      if (taskStatus.task_status === 'SUCCESS') {
        const imageUrl = taskStatus.image_result?.[0]?.url;

        if (!imageUrl) {
          return {
            error: new Error('Task succeeded but no image URL found'),
            status: 'failed',
          };
        }

        return {
          data: { imageUrl },
          status: 'success',
        };
      }

      if (taskStatus.task_status === 'FAIL') {
        return {
          error: new Error(taskStatus.error?.message || 'Image generation failed'),
          status: 'failed',
        };
      }

      return { status: 'pending' };
    },
    logger: {
      debug: (message: any, ...args: any[]) => log(message, ...args),
      error: (message: any, ...args: any[]) => log(message, ...args),
    },
    pollingQuery: () => queryZhipuImageStatus(inferenceId, options),
  });
}

/**
 * Zhipu image generation implementation
 * API docs: https://open.bigmodel.cn
 */
export async function createZhipuImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const { prompt, resolution, size, watermark, width, height } = params;

  log('Creating image with Zhipu API - model: %s, params: %O', model, params);

  const baseURL = options.baseURL || 'https://open.bigmodel.cn/api/paas/v4';

  const body: Record<string, unknown> = {
    model,
    prompt,
    ...(resolution && { quality: resolution }),
  };

  if (size) {
    body.size = size;
  } else if (width !== undefined && height !== undefined) {
    body.size = `${width}x${height}`;
  }

  body.watermark_enabled = watermark ?? false;

  const isSyncModel = model.startsWith('cogview');
  const endpoint = isSyncModel
    ? `${baseURL}/images/generations`
    : `${baseURL}/async/images/generations`;

  const response = await fetch(endpoint, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('Zhipu image API error: %s %s', response.status, errorText);
    throw new Error(`Zhipu image API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as ZhipuImageStatusResponse;
  log('Zhipu image API response: %O', data);

  const imageUrl = data.data?.[0]?.url;
  if (imageUrl) {
    return { imageUrl };
  }

  if (isSyncModel) {
    throw new Error('Invalid sync response: missing image URL');
  }

  if (!data.id) {
    throw new Error('Invalid response: missing task id');
  }

  return await pollZhipuImageStatus(data.id, {
    apiKey: options.apiKey,
    baseURL,
  });
}
