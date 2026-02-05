import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-image:qwen');

interface QwenImageTaskResponse {
  output: {
    error_message?: string;
    results?: Array<{
      url: string;
    }>;
    task_id: string;
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  };
  request_id: string;
}

// Interface for qwen-image-edit multimodal-generation response
interface QwenImageEditResponse {
  output: {
    choices: Array<{
      message: {
        content: Array<{
          image: string;
        }>;
      };
    }>;
  };
  request_id: string;
}

/**
 * Create an image generation task with Qwen API for text-to-image models
 */
async function createImageTask(payload: CreateImagePayload, apiKey: string): Promise<string> {
  const { model, params } = payload;
  // I can only say that the design of Alibaba Cloud's API is really bad; each model has a different endpoint path.
  const endpoint = `https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis`;
  log('Creating image task with model: %s, endpoint: %s', model, endpoint);

  const response = await fetch(endpoint, {
    body: JSON.stringify({
      input: {
        prompt: params.prompt,
        // negativePrompt is not part of standard parameters
        // but can be supported by extending the params type if needed
      },
      model,
      parameters: {
        n: 1,
        ...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
        ...(params.width && params.height
          ? { size: `${params.width}*${params.height}` }
          : params.size
            ? { size: params.size.replaceAll('x', '*') }
            : { size: '1024*1024' }),
      },
    }),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
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
      `Failed to create image task (${response.status}): ${errorData?.message || response.statusText}`,
    );
  }

  const data: QwenImageTaskResponse = await response.json();
  log('Task created with ID: %s', data.output.task_id);

  return data.output.task_id;
}

/**
 * Create image with Qwen image-edit API for image-to-image models
 * This is a synchronous API that returns the result directly
 */
async function createImageEdit(
  payload: CreateImagePayload,
  apiKey: string,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const endpoint = `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`;
  log('Creating image edit with model: %s, endpoint: %s', model, endpoint);

  // Handle imageUrls to imageUrl conversion
  let imageUrl = params.imageUrl;
  if (!imageUrl && params.imageUrls && params.imageUrls.length > 0) {
    imageUrl = params.imageUrls[0];
    log('Converting imageUrls to imageUrl: using first image %s', imageUrl);
  }

  if (!imageUrl) {
    throw new Error('imageUrl or imageUrls is required for qwen-image-edit model');
  }

  const response = await fetch(endpoint, {
    body: JSON.stringify({
      input: {
        messages: [
          {
            content: [{ image: imageUrl }, { text: params.prompt }],
            role: 'user',
          },
        ],
      },
      model,
      parameters: {
        ...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
      },
    }),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
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
      `Failed to create image edit (${response.status}): ${errorData?.message || response.statusText}`,
    );
  }

  const data: QwenImageEditResponse = await response.json();

  if (!data.output.choices || data.output.choices.length === 0) {
    throw new Error('No image choices returned from qwen-image-edit API');
  }

  const choice = data.output.choices[0];
  if (!choice.message.content || choice.message.content.length === 0) {
    throw new Error('No image content returned from qwen-image-edit API');
  }

  const imageContent = choice.message.content.find((content) => 'image' in content);
  if (!imageContent) {
    throw new Error('No image found in response content');
  }

  const resultImageUrl = imageContent.image;
  log('Image edit generated successfully: %s', resultImageUrl);

  return { imageUrl: resultImageUrl };
}

/**
 * Query the status of an image generation task
 */
async function queryTaskStatus(taskId: string, apiKey: string): Promise<QwenImageTaskResponse> {
  const endpoint = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;

  log('Querying task status for: %s', taskId);

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      // Failed to parse JSON error response
    }
    throw new Error(
      `Failed to query task status (${response.status}): ${errorData?.message || response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Create image using Qwen API
 * Supports both text-to-image (async with polling) and image-to-image (sync) workflows
 */
export async function createQwenImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { apiKey, provider } = options;
  const { model } = payload;

  try {
    // Check if this is qwen-image-edit model for image-to-image
    if (model === 'qwen-image-edit') {
      log('Using multimodal-generation API for qwen-image-edit model');
      return await createImageEdit(payload, apiKey);
    }

    // Default to text-to-image workflow for other qwen models
    log('Using text2image API for model: %s', model);

    // 1. Create image generation task
    const taskId = await createImageTask(payload, apiKey);

    // 2. Poll task status until completion using asyncifyPolling
    const result = await asyncifyPolling<QwenImageTaskResponse, CreateImageResponse>({
      checkStatus: (taskStatus: QwenImageTaskResponse): TaskResult<CreateImageResponse> => {
        log('Task %s status: %s', taskId, taskStatus.output.task_status);

        if (taskStatus.output.task_status === 'SUCCEEDED') {
          if (!taskStatus.output.results || taskStatus.output.results.length === 0) {
            return {
              error: new Error('Task succeeded but no images generated'),
              status: 'failed',
            };
          }

          const generatedImageUrl = taskStatus.output.results[0].url;
          log('Image generated successfully: %s', generatedImageUrl);

          return {
            data: { imageUrl: generatedImageUrl },
            status: 'success',
          };
        }

        if (taskStatus.output.task_status === 'FAILED') {
          const errorMessage = taskStatus.output.error_message || 'Image generation task failed';
          return {
            error: new Error(`Qwen image generation failed: ${errorMessage}`),
            status: 'failed',
          };
        }

        // Continue polling for pending/running status or other unknown statuses
        return { status: 'pending' };
      },
      logger: {
        debug: (message: any, ...args: any[]) => log(message, ...args),
        error: (message: any, ...args: any[]) => log(message, ...args),
      },
      pollingQuery: () => queryTaskStatus(taskId, apiKey),
    });

    return result;
  } catch (error) {
    log('Error in createQwenImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
