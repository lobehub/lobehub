import createDebug from 'debug';

import { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { type TaskResult, asyncifyPolling } from '../../utils/asyncifyPolling';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-image:qwen');

const text2ImageModels = new Set([
  'wan2.5-t2i-preview',
  'wan2.2-t2i-flash',
  'wan2.2-t2i-plus',
  'wanx2.1-t2i-turbo',
  'wanx2.1-t2i-plus',
  'wanx2.0-t2i-turbo',
  'wanx-v1',
  'stable-diffusion-xl',
  'stable-diffusion-v1.5',
  'stable-diffusion-3.5-large',
  'stable-diffusion-3.5-large-turbo',
  'flux-schnell',
  'flux-dev',
  'flux-merged',
]);

const image2ImageModels = new Set(['wan2.5-i2i-preview']);

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

// Interface for multimodal-generation response
interface QwenMultimodalGenerationResponse {
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
 * Create an image generation task with Qwen API
 * Supports both text-to-image and image-to-image workflows
 */
async function createQwenImageTask(
  payload: CreateImagePayload,
  apiKey: string,
  endpoint: 'text2image' | 'image2image',
): Promise<string> {
  const { model, params } = payload;
  const url = `https://dashscope.aliyuncs.com/api/v1/services/aigc/${endpoint}/image-synthesis`;
  log('Creating %s task with model: %s, endpoint: %s', endpoint, model, url);

  const input: Record<string, any> = {
    prompt: params.prompt,
  };

  const parameters: Record<string, any> = {
    n: 1,
    ...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
    ...(params.width && params.height
      ? { size: `${params.width}*${params.height}` }
      : params.size
        ? { size: params.size.replaceAll('x', '*') }
        : { size: '1024*1024' }),
  };

  if (endpoint === 'image2image') {
    let images = params.imageUrls;
    if (!images && params.imageUrl) {
      images = [params.imageUrl];
      log('Converting imageUrl to images array: using image %s', params.imageUrl);
    }

    if (!images || images.length === 0) {
      throw new Error('imageUrls or imageUrl is required for image-to-image models');
    }

    input.images = images;
  }

  const response = await fetch(url, {
    body: JSON.stringify({
      input,
      model,
      parameters,
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
      `Failed to create ${endpoint} task (${response.status}): ${errorData?.message || response.statusText}`,
    );
  }

  const data: QwenImageTaskResponse = await response.json();
  log('Task created with ID: %s', data.output.task_id);

  return data.output.task_id;
}

/**
 * Create image with Qwen multimodal-generation API
 * This is a synchronous API that returns the result directly
 * Supports both text-to-image (t2i) and image-to-image (i2i) workflows
 */
async function createMultimodalGeneration(
  payload: CreateImagePayload,
  apiKey: string,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const endpoint = `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`;
  log('Creating image with model: %s, endpoint: %s', model, endpoint);

  const content: Array<{ image: string } | { text: string }> = [{ text: params.prompt }];

  if (params.imageUrl) {
    content.unshift({ image: params.imageUrl });
    log('Using imageUrl for image-to-image generation');
  } else if (params.imageUrls && params.imageUrls.length > 0) {
    content.unshift({ image: params.imageUrls[0] });
    log('Using first imageUrls for image-to-image generation');
  }

  const response = await fetch(endpoint, {
    body: JSON.stringify({
      input: {
        messages: [
          {
            content,
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
      `Failed to create image (${response.status}): ${errorData?.message || response.statusText}`,
    );
  }

  const data: QwenMultimodalGenerationResponse = await response.json();

  if (!data.output.choices || data.output.choices.length === 0) {
    throw new Error('No image choices returned from API');
  }

  const choice = data.output.choices[0];
  if (!choice.message.content || choice.message.content.length === 0) {
    throw new Error('No image content returned from API');
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
 * Supports three types:
 * - text2image (async with polling for legacy models)
 * - image2image (async with polling for legacy models)
 * - multimodal-generation (sync for new models, default fallback)
 */
export async function createQwenImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { apiKey, provider } = options;
  const { model } = payload;

  try {
    if (image2ImageModels.has(model)) {
      log('Using image2image API for model: %s', model);

      const taskId = await createQwenImageTask(payload, apiKey, 'image2image');

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

          return { status: 'pending' };
        },
        logger: {
          debug: (message: any, ...args: any[]) => log(message, ...args),
          error: (message: any, ...args: any[]) => log(message, ...args),
        },
        pollingQuery: () => queryTaskStatus(taskId, apiKey),
      });

      return result;
    }

    if (text2ImageModels.has(model)) {
      log('Using text2image API for model: %s', model);

      const taskId = await createQwenImageTask(payload, apiKey, 'text2image');

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

          return { status: 'pending' };
        },
        logger: {
          debug: (message: any, ...args: any[]) => log(message, ...args),
          error: (message: any, ...args: any[]) => log(message, ...args),
        },
        pollingQuery: () => queryTaskStatus(taskId, apiKey),
      });

      return result;
    }

    log('Using multimodal-generation API for model: %s', model);
    return await createMultimodalGeneration(payload, apiKey);
  } catch (error) {
    log('Error in createQwenImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
