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

const imageGenerationModels = [/^kling/];

const imageRequiredModels = [/^qwen-image-edit/, /^wan2\.(2|5)-i2i-/, /^wan2\.6-image/];

// Helper function to check if model matches any pattern in the array
function matchesModel(model: string, patterns: Array<string | RegExp>): boolean {
  return patterns.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(model) : pattern === model,
  );
}

interface QwenImageTaskResponse {
  output: {
    choices?: Array<{
      message: {
        content: Array<{
          image?: string;
          type?: string;
        }>;
      };
    }>;
    error_message?: string;
    results?: Array<{
      url: string;
    }>;
    task_id?: string;
    task_status?: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  };
  request_id: string;
}

function parseImageFromTaskOutput(
  output: QwenImageTaskResponse['output'],
  model: string,
): CreateImageResponse {
  if (!output.choices || output.choices.length === 0) {
    throw new Error(`No image choices returned from API for model ${model}`);
  }

  const choice = output.choices[0];
  if (!choice.message.content || choice.message.content.length === 0) {
    throw new Error(`No image content returned from API for model ${model}`);
  }

  const imageContent = choice.message.content.find((content) => typeof content.image === 'string');
  if (!imageContent?.image) {
    throw new Error(`No image found in response content for model ${model}`);
  }

  log('Image generated successfully: %s', imageContent.image);

  return { imageUrl: imageContent.image };
}

/**
 * Create an image generation task with Qwen API
 * Supports both text-to-image and image-to-image workflows
 */
async function createQwenImageLegacyTask(
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
  if (!data.output.task_id) {
    throw new Error(`No task_id returned when creating ${endpoint} task for model ${model}`);
  }
  log('Task created with ID: %s', data.output.task_id);

  return data.output.task_id;
}

/**
 * Create image with Qwen image/multimodal-generation API
 * For image-generation endpoint, this may return a pending task that requires polling.
 * For multimodal-generation endpoint, this returns the result directly.
 * Supports both text-to-image (t2i) and image-to-image (i2i) workflows
 */
async function createQwenImageTask(
  payload: CreateImagePayload,
  apiKey: string,
  endpoint: 'image-generation' | 'multimodal-generation',
  baseUrl: string,
  provider: string,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const url = `${baseUrl}/api/v1/services/aigc/${endpoint}/generation`;
  log('Creating image with model: %s, endpoint: %s', model, url);

  // Check if this model requires an image
  const requiresImage = matchesModel(model, imageRequiredModels);

  if (requiresImage && !params.imageUrl && (!params.imageUrls || params.imageUrls.length === 0)) {
    throw AgentRuntimeError.createImage({
      error: new Error(`imageUrl or imageUrls is required for model ${model}`),
      errorType: 'ProviderBizError',
      provider,
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

  const response = await fetch(url, {
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
        ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
        ...(params.resolution ? { resolution: params.resolution } : {}),
        ...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
      },
    }),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(endpoint === 'image-generation' ? { 'X-DashScope-Async': 'enable' } : {}),
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

  const data: QwenImageTaskResponse = await response.json();

  if (data.output.task_status === 'FAILED') {
    const errorMessage = data.output.error_message || 'Task failed without error message';
    throw new Error(`Image generation failed for model ${model}: ${errorMessage}`);
  }

  if (data.output.task_id && !(data.output.choices && data.output.choices.length > 0)) {
    const taskId = data.output.task_id;
    log('Image generation task created, start polling task: %s', taskId);

    return asyncifyPolling<QwenImageTaskResponse, CreateImageResponse>({
      checkStatus: (taskStatus: QwenImageTaskResponse): TaskResult<CreateImageResponse> => {
        log('Task %s status: %s', taskId, taskStatus.output.task_status);

        if (taskStatus.output.task_status === 'SUCCEEDED') {
          try {
            return {
              data: parseImageFromTaskOutput(taskStatus.output, model),
              status: 'success',
            };
          } catch (error) {
            return {
              error: error as Error,
              status: 'failed',
            };
          }
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
      pollingQuery: () => queryTaskStatus(taskId, apiKey, baseUrl),
    });
  }

  return parseImageFromTaskOutput(data.output, model);
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
    const isImageGeneration = matchesModel(model, imageGenerationModels);

    if (isText2Image || isImage2Image) {
      const endpoint = isImage2Image ? 'image2image' : 'text2image';
      log('Using %s API for model: %s', endpoint, model);

      const taskId = await createQwenImageLegacyTask(
        payload,
        apiKey,
        endpoint,
        provider,
        dashscopeURL,
      );

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

    const endpoint = isImageGeneration ? 'image-generation' : 'multimodal-generation';
    log('Using %s API for model: %s', endpoint, model);
    return await createQwenImageTask(payload, apiKey, endpoint, dashscopeURL, provider);
  } catch (error) {
    log('Error in createQwenImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
