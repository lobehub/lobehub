import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-video:qwen');

// Model patterns for different video generation types
const image2VideoModels = [/^wan2\.(2|5)-i2v-/, /^wanx2\.(0|1)-i2v-/];
const keyframe2VideoModels = [/^wan2\.(2|5)-kf2v-/];

// Helper function to check if model matches any pattern in the array
function matchesModelPattern(model: string, patterns: Array<RegExp>): boolean {
  return patterns.some((pattern) => pattern.test(model));
}

interface QwenVideoTaskResponse {
  output: {
    error_message?: string;
    task_id: string;
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
    video_url?: string;
    cover_image_url?: string;
    // For keyframe models
    first_frame_url?: string;
    last_frame_url?: string;
  };
  request_id: string;
  usage?: {
    duration?: number;
    size?: string;
    video_count?: number;
  };
}

/**
 * Create a video generation task with Qwen DashScope API
 * Supports text-to-video, image-to-video, and keyframe-to-video
 */
async function createVideoTask(
  payload: CreateVideoPayload,
  apiKey: string,
  taskType: 'video-generation' | 'image2video',
  provider: string,
  baseUrl: string,
): Promise<string> {
  const { model, params } = payload;
  const { prompt, imageUrl, endImageUrl } = params;

  // Determine the endpoint based on task type
  const endpoint = taskType === 'video-generation' ? 'video-synthesis' : 'video-synthesis';
  const url = `${baseUrl}/api/v1/services/aigc/${taskType}/${endpoint}`;

  log('Creating %s task with model: %s, endpoint: %s', taskType, model, url);

  const input: Record<string, any> = {};
  const parameters: Record<string, any> = {};

  // Build input based on model type
  if (matchesModelPattern(model, keyframe2VideoModels)) {
    // Keyframe-to-video requires first_frame_url and last_frame_url
    if (!imageUrl || !endImageUrl) {
      throw AgentRuntimeError.createVideo({
        error: new Error(
          'imageUrl (first frame) and endImageUrl (last frame) are required for keyframe-to-video models',
        ),
        errorType: 'ProviderBizError',
        provider,
      });
    }
    input.first_frame_url = imageUrl;
    input.last_frame_url = endImageUrl;
    input.prompt = prompt;
  } else if (matchesModelPattern(model, image2VideoModels)) {
    // Image-to-video requires img_url
    if (!imageUrl) {
      throw AgentRuntimeError.createVideo({
        error: new Error('imageUrl is required for image-to-video models'),
        errorType: 'ProviderBizError',
        provider,
      });
    }
    input.img_url = imageUrl;
    input.prompt = prompt;
  } else {
    // Text-to-video only needs prompt
    input.prompt = prompt;
  }

  // Add optional parameters
  if (params.size) {
    // Convert size format from "widthxheight" to "width*height" if needed
    parameters.size = params.size.replace('x', '*');
  }

  if (params.duration) {
    parameters.duration = params.duration;
  }

  if (params.generateAudio) {
    parameters.audio = params.generateAudio;
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
      `Failed to create ${taskType} task for model ${model} (${response.status}): ${errorData?.message || response.statusText}`,
    );
  }

  const data: QwenVideoTaskResponse = await response.json();
  log('Video task created with ID: %s', data.output.task_id);

  return data.output.task_id;
}

/**
 * Query the status of a video generation task
 */
async function queryTaskStatus(
  taskId: string,
  apiKey: string,
  baseUrl: string,
): Promise<QwenVideoTaskResponse> {
  const endpoint = `${baseUrl}/api/v1/tasks/${taskId}`;

  log('Querying task status for: %s', taskId);

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
      `Failed to query task status for ${taskId} (${response.status}): ${errorData?.message || response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Create video using Qwen DashScope API
 * Supports three types:
 * - text-to-video (wan2.2-t2v-plus, wanx2.0-t2v-*)
 * - image-to-video (wan2.2-i2v-plus, wanx2.0-i2v-*)
 * - keyframe-to-video (wan2.2-kf2v-flash)
 */
export async function createQwenVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { apiKey, baseURL, provider } = options;
  const { model, params } = payload;

  // Check if URL has /compatible-mode/v1 suffix and remove it
  const suffixIndex = baseURL ? baseURL.indexOf('/compatible-mode/v1') : -1;
  const dashscopeURL: string =
    suffixIndex > -1 ? baseURL!.slice(0, suffixIndex) : baseURL || 'https://dashscope.aliyuncs.com';

  log('Using dashscopeURL: %s', dashscopeURL);
  log('Creating video with model: %s, params: %O', model, params);

  try {
    const isKeyframe2Video = matchesModelPattern(model, keyframe2VideoModels);

    // Determine task type based on model
    let taskType: 'video-generation' | 'image2video';

    if (isKeyframe2Video) {
      taskType = 'image2video';
      log('Using image2video API for model: %s', model);
    } else {
      taskType = 'video-generation';
      log('Using video-generation API for model: %s', model);
    }

    // Create the video task
    const taskId = await createVideoTask(payload, apiKey, taskType, provider, dashscopeURL);

    // Poll for completion using asyncifyPolling
    const result = await asyncifyPolling<QwenVideoTaskResponse, CreateVideoResponse>({
      checkStatus: (taskStatus: QwenVideoTaskResponse): TaskResult<CreateVideoResponse> => {
        log('Task %s status: %s', taskId, taskStatus.output.task_status);

        if (taskStatus.output.task_status === 'SUCCEEDED') {
          if (!taskStatus.output.video_url) {
            return {
              error: new Error('Task succeeded but no video URL generated'),
              status: 'failed',
            };
          }

          log('Video generation succeeded: %s', taskId);
          log('Video URL: %s', taskStatus.output.video_url);

          return {
            data: { inferenceId: taskId, videoUrl: taskStatus.output.video_url },
            status: 'success',
          };
        }

        if (taskStatus.output.task_status === 'FAILED') {
          const errorMessage =
            taskStatus.output.error_message || 'Video generation failed without error message';
          log('Video generation failed: %s, error: %s', taskId, errorMessage);

          return {
            error: new Error(`Video generation failed for model ${model}: ${errorMessage}`),
            status: 'failed',
          };
        }

        log('Video generation in progress: %s (status: %s)', taskId, taskStatus.output.task_status);
        return { status: 'pending' };
      },
      logger: {
        debug: (message: any, ...args: any[]) => log(message, ...args),
        error: (message: any, ...args: any[]) => log(message, ...args),
      },
      pollingQuery: () => queryTaskStatus(taskId, apiKey, dashscopeURL),
    });

    log('Video generation completed, returning video URL');
    return result;
  } catch (error) {
    log('Error in createQwenVideo: %O', error);

    throw AgentRuntimeError.createVideo({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
