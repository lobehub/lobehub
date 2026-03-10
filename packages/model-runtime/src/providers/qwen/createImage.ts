import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-image:qwen');

const text2ImageModels = [
  /^wan2\.(2|5)-t2i-/,
  /^wanx2\.(0|1)-t2i-/,
  /^wanx-v1/,
  /^stable-diffusion-/,
  /^flux-/,
];

const image2ImageModels = [/^wan2\.(2|5)-i2i-/];

const imageRequiredModels = [/^qwen-image-edit/, /^wan2\.(2|5)-i2i-/, /^wan2\.6-image/];

// Helper function to check if model matches any pattern in the array
function matchesModel(model: string, patterns: Array<string | RegExp>): boolean {
  return patterns.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(model) : pattern === model,
  );
}

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
  provider: string,
  baseUrl: string,
): Promise<string> {
  const { model, params } = payload;
  const url = `${baseUrl}/api/v1/services/aigc/${endpoint}/image-synthesis`;
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
      throw AgentRuntimeError.createImage({
        error: new Error('imageUrls or imageUrl is required for image-to-image models'),
        errorType: 'ProviderBizError',
        provider,
      });
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
      `Failed to create ${endpoint} task for model ${model} (${response.status}): ${errorData?.message || response.statusText}`,
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
  baseUrl: string,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const endpoint = `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`;
  log('Creating image with model: %s, endpoint: %s', model, endpoint);

  // Check if this model requires an image
  const requiresImage = matchesModel(model, imageRequiredModels);

  if (requiresImage && !params.imageUrl && (!params.imageUrls || params.imageUrls.length === 0)) {
    throw AgentRuntimeError.createImage({
      error: new Error(`imageUrl or imageUrls is required for model ${model}`),
      errorType: 'ProviderBizError',
      provider: 'qwen',
    });
  }

  const content: Array<{ image: string } | { text: string }> = [{ text: params.prompt }];

  if (params.imageUrl) {
    content.unshift({ image: params.imageUrl });
  } else if (params.imageUrls && params.imageUrls.length > 0) {
    // Add each image as a separate object in the content array
    for (const imageUrl of params.imageUrls) {
      content.unshift({ image: imageUrl });
    }
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
      `Failed to create image for model ${model} (${response.status}): ${errorData?.message || response.statusText}`,
    );
  }

  const data: QwenMultimodalGenerationResponse = await response.json();

  if (!data.output.choices || data.output.choices.length === 0) {
    throw new Error(`No image choices returned from API for model ${model}`);
  }

  const choice = data.output.choices[0];
  if (!choice.message.content || choice.message.content.length === 0) {
    throw new Error(`No image content returned from API for model ${model}`);
  }

  const imageContent = choice.message.content.find((content) => 'image' in content);
  if (!imageContent) {
    throw new Error(`No image found in response content for model ${model}`);
  }

  const resultImageUrl = imageContent.image;
  log('Image edit generated successfully: %s', resultImageUrl);

  return { imageUrl: resultImageUrl };
}

/**
 * Query the status of an image generation task
 */
async function queryTaskStatus(
  taskId: string,
  apiKey: string,
  baseUrl: string,
): Promise<QwenImageTaskResponse> {
  const endpoint = `${baseUrl}/api/v1/tasks/${taskId}`;

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
      `Failed to query task status for ${taskId} (${response.status}): ${errorData?.message || response.statusText}`,
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
  const { apiKey, baseURL, provider } = options;
  const { model } = payload;

  // Check if URL has /compatible-mode/v1 suffix and remove it
  const suffixIndex = baseURL ? baseURL.indexOf('/compatible-mode/v1') : -1;
  const dashscopeURL: string =
    suffixIndex > -1 ? baseURL!.slice(0, suffixIndex) : baseURL || 'https://dashscope.aliyuncs.com';
  log('Using dashscopeURL: %s', dashscopeURL);

  try {
    const isText2Image = matchesModel(model, text2ImageModels);
    const isImage2Image = matchesModel(model, image2ImageModels);

    if (isText2Image || isImage2Image) {
      const endpoint = isImage2Image ? 'image2image' : 'text2image';
      log('Using %s API for model: %s', endpoint, model);

      const taskId = await createQwenImageTask(payload, apiKey, endpoint, provider, dashscopeURL);

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
            const errorMessage =
              taskStatus.output.error_message || 'Task failed without error message';
            return {
              error: new Error(`Image generation failed for model ${model}: ${errorMessage}`),
              status: 'failed',
            };
          }

          return { status: 'pending' };
        },
        logger: {
          debug: (message: any, ...args: any[]) => log(message, ...args),
          error: (message: any, ...args: any[]) => log(message, ...args),
        },
        pollingQuery: () => queryTaskStatus(taskId, apiKey, dashscopeURL),
      });

      return result;
    }

    log('Using multimodal-generation API for model: %s', model);
    return await createMultimodalGeneration(payload, apiKey, dashscopeURL);
  } catch (error) {
    log('Error in createQwenImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
