import { imageUrlToBase64 } from '@lobechat/utils';
import createDebug from 'debug';
import type { RuntimeImageGenParamsValue } from 'model-bank';

import { AgentRuntimeErrorType } from '../../types/error';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';
import { AgentRuntimeError } from '../../utils/createError';
import { parseDataUri } from '../../utils/uriParser';
import type { BflAsyncResponse, BflModelId, BflRequest, BflResultResponse } from './types';
import { BFL_ENDPOINTS, BflStatusResponse } from './types';

const log = createDebug('lobe-image:bfl');

const BASE_URL = 'https://api.bfl.ai';

interface BflCreateImageOptions {
  apiKey: string;
  baseURL?: string;
  provider: string;
}

/**
 * Convert image URL to base64 format required by BFL API
 */
async function convertImageToBase64(imageUrl: string): Promise<string> {
  try {
    const { type } = parseDataUri(imageUrl);

    if (type === 'base64') {
      // Already in base64 format, extract the base64 part
      const base64Match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (base64Match) {
        return base64Match[1];
      }
      throw new Error('Invalid base64 format');
    }

    if (type === 'url') {
      // Convert URL to base64
      const { base64 } = await imageUrlToBase64(imageUrl);
      return base64;
    }

    throw new Error(`Invalid image URL format: ${imageUrl}`);
  } catch (error) {
    log('Error converting image to base64: %O', error);
    throw error;
  }
}

/**
 * Build request payload for different BFL models
 */
async function buildRequestPayload(
  model: BflModelId,
  params: CreateImagePayload['params'],
): Promise<BflRequest> {
  log('Building request payload for model: %s', model);

  // Define parameter mapping (BFL API specific)
  const paramsMap = new Map<RuntimeImageGenParamsValue, string>([
    ['aspectRatio', 'aspect_ratio'],
    ['cfg', 'guidance'],
  ]);

  // Fixed parameters for all BFL models
  const defaultPayload: Record<string, unknown> = {
    output_format: 'png',
    safety_tolerance: 6,
    ...(model.includes('ultra') && { raw: true }),
  };

  // Map user parameters, filtering out undefined values
  const userPayload: Record<string, unknown> = Object.fromEntries(
    (Object.entries(params) as [keyof typeof params, any][])
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [paramsMap.get(key) ?? key, value]),
  );

  // Handle multiple input images (imageUrls) for Kontext models
  if (params.imageUrls && params.imageUrls.length > 0) {
    for (let i = 0; i < Math.min(params.imageUrls.length, 4); i++) {
      const fieldName = i === 0 ? 'input_image' : `input_image_${i + 1}`;
      userPayload[fieldName] = await convertImageToBase64(params.imageUrls[i]);
    }
    // Remove the original imageUrls field as it's now mapped to input_image_*
    delete userPayload.imageUrls;
  }

  // Handle single image input (imageUrl)
  if (params.imageUrl) {
    userPayload.image_prompt = await convertImageToBase64(params.imageUrl);
    // Remove the original imageUrl field as it's now mapped to image_prompt
    delete userPayload.imageUrl;
  }

  // Combine default and user payload
  const payload = {
    ...defaultPayload,
    ...userPayload,
  };

  return payload as BflRequest;
}

/**
 * Submit image generation task to BFL API
 */
async function submitTask(
  model: BflModelId,
  payload: BflRequest,
  options: BflCreateImageOptions,
): Promise<BflAsyncResponse> {
  const endpoint = BFL_ENDPOINTS[model];
  const url = `${options.baseURL || BASE_URL}${endpoint}`;

  log('Submitting task to: %s', url);

  const response = await fetch(url, {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      'x-key': options.apiKey,
    },
    method: 'POST',
  });

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      // Failed to parse JSON error response
    }

    throw new Error(
      `BFL API error (${response.status}): ${errorData?.detail?.[0]?.msg || response.statusText}`,
    );
  }

  const data: BflAsyncResponse = await response.json();
  log('Task submitted successfully with ID: %s', data.id);

  return data;
}

/**
 * Query task status using BFL API
 */
async function queryTaskStatus(
  pollingUrl: string,
  options: BflCreateImageOptions,
): Promise<BflResultResponse> {
  log('Querying task status using polling URL: %s', pollingUrl);

  const response = await fetch(pollingUrl, {
    headers: {
      'accept': 'application/json',
      'x-key': options.apiKey,
    },
    method: 'GET',
  });

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      // Failed to parse JSON error response
    }

    throw new Error(
      `Failed to query task status (${response.status}): ${errorData?.detail?.[0]?.msg || response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Create image using BFL API with async task polling
 */
export async function createBflImage(
  payload: CreateImagePayload,
  options: BflCreateImageOptions,
): Promise<CreateImageResponse> {
  const { model, params } = payload;

  if (!BFL_ENDPOINTS[model as BflModelId]) {
    throw AgentRuntimeError.createImage({
      error: new Error(`Unsupported BFL model: ${model}`),
      errorType: AgentRuntimeErrorType.ModelNotFound,
      provider: options.provider,
    });
  }

  try {
    // 1. Build request payload
    const requestPayload = await buildRequestPayload(model as BflModelId, params);

    // 2. Submit image generation task
    const taskResponse = await submitTask(model as BflModelId, requestPayload, options);

    // 3. Poll task status until completion using asyncifyPolling
    return await asyncifyPolling<BflResultResponse, CreateImageResponse>({
      checkStatus: (taskStatus: BflResultResponse): TaskResult<CreateImageResponse> => {
        log('Task %s status: %s', taskResponse.id, taskStatus.status);

        switch (taskStatus.status) {
          case BflStatusResponse.Ready: {
            if (!taskStatus.result?.sample) {
              return {
                error: new Error('Task succeeded but no image generated'),
                status: 'failed',
              };
            }

            const imageUrl = taskStatus.result.sample;
            log('Image generated successfully: %s', imageUrl);

            return {
              data: { imageUrl },
              status: 'success',
            };
          }
          case BflStatusResponse.Error:
          case BflStatusResponse.ContentModerated:
          case BflStatusResponse.RequestModerated: {
            // Extract error details if available, otherwise use status
            let errorMessage = `Image generation failed with status: ${taskStatus.status}`;

            // Check for additional error details in various possible fields
            if (taskStatus.details && typeof taskStatus.details === 'object') {
              errorMessage += ` - Details: ${JSON.stringify(taskStatus.details)}`;
            } else if (taskStatus.result && typeof taskStatus.result === 'object') {
              errorMessage += ` - Result: ${JSON.stringify(taskStatus.result)}`;
            }

            return {
              error: new Error(errorMessage),
              status: 'failed',
            };
          }
          case BflStatusResponse.TaskNotFound: {
            return {
              error: new Error('Task not found - may have expired'),
              status: 'failed',
            };
          }
          default: {
            // Continue polling for Pending status or other unknown statuses
            return { status: 'pending' };
          }
        }
      },
      logger: {
        debug: (message: any, ...args: any[]) => log(message, ...args),
        error: (message: any, ...args: any[]) => log(message, ...args),
      },
      pollingQuery: () => queryTaskStatus(taskResponse.polling_url, options),
    });
  } catch (error) {
    log('Error in createBflImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider: options.provider,
    });
  }
}
