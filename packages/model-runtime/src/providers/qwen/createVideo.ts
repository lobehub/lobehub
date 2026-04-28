import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-video:qwen');

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

// Model patterns for different video generation types
const image2VideoModels = [
  /^wan2\.(2|5)-i2v-/,
  /^wanx2\.(0|1)-i2v-/,
  /img2video$/,
  /reference2video$/,
  /i2v$/,
  /it2v$/,
];
const keyframe2VideoModels = [/^wan2\.(2|5)-kf2v-/, /start-end2video$/, /kf2v$/];
const reference2VideoModels = [/r2v$/];

/**
 * Query the status of a video generation task
 */
export async function queryQwenVideoStatus(
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
 * Poll video status and return standardized result
 */
export async function pollQwenVideoStatus(
  taskId: string,
  apiKey: string,
  baseUrl: string,
): Promise<
  | { status: 'success'; videoUrl: string }
  | { status: 'failed'; error: string }
  | { status: 'pending' }
> {
  const response = await queryQwenVideoStatus(taskId, apiKey, baseUrl);

  if (response.output.task_status === 'SUCCEEDED') {
    const videoUrl = response.output.video_url;
    if (!videoUrl) {
      return { error: 'Task succeeded but no video URL found', status: 'failed' };
    }
    return { status: 'success', videoUrl };
  }

  if (response.output.task_status === 'FAILED') {
    return { error: response.output.error_message || 'Video generation failed', status: 'failed' };
  }

  return { status: 'pending' };
}

// Helper function to check if model matches any pattern in the array
function matchesModelPattern(model: string, patterns: Array<RegExp>): boolean {
  return patterns.some((pattern) => pattern.test(model));
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
  const { prompt, imageUrl, imageUrls, endImageUrl } = params;

  // Determine the endpoint based on task type
  const url = `${baseUrl}/api/v1/services/aigc/${taskType}/video-synthesis`;

  log('Creating %s task with model: %s, endpoint: %s', taskType, model, url);

  const input: Record<string, any> = {};
  const parameters: Record<string, any> = {};

  // Validate required parameters based on model type
  if (
    matchesModelPattern(model, image2VideoModels) ||
    matchesModelPattern(model, reference2VideoModels)
  ) {
    if (!imageUrl) {
      throw AgentRuntimeError.createVideo({
        error: new Error('imageUrl is required for image-to-video models'),
        errorType: 'ProviderBizError',
        provider,
      });
    }
  } else if (matchesModelPattern(model, keyframe2VideoModels) && (!imageUrl || !endImageUrl)) {
    throw AgentRuntimeError.createVideo({
      error: new Error(
        'imageUrl (first frame) and endImageUrl (last frame) are required for keyframe-to-video models',
      ),
      errorType: 'ProviderBizError',
      provider,
    });
  }

  // Handle media input based on model type
  if (model.startsWith('vidu/')) {
    const media = [];
    if (imageUrl) {
      media.push({
        type: 'image',
        url: imageUrl,
      });
    }
    if (imageUrls && imageUrls.length > 0) {
      imageUrls.forEach((url) =>
        media.push({
          type: 'image',
          url,
        }),
      );
    }
    if (endImageUrl) {
      media.push({
        type: 'image',
        url: endImageUrl,
      });
    }
    if (media.length > 0) {
      input.media = media;
    }
  } else if (model.startsWith('kling/')) {
    const media = [];
    if (imageUrl) {
      media.push({
        type: 'first_frame',
        url: imageUrl,
      });
    }
    if (imageUrls && imageUrls.length > 0) {
      if (imageUrls.length === 1 && endImageUrl) {
        media.push({
          type: 'first_frame',
          url: imageUrls[0],
        });
      } else {
        imageUrls.forEach((url) =>
          media.push({
            type: 'refer',
            url,
          }),
        );
      }
    }
    if (endImageUrl) {
      media.push({
        type: 'last_frame',
        url: endImageUrl,
      });
    }
    if (media.length > 0) {
      input.media = media;
    }
  } else if (model.startsWith('pixverse/')) {
    const media = [];
    if (imageUrls && imageUrls.length > 0) {
      imageUrls.forEach((url) =>
        media.push({
          type: 'image_url',
          url,
        }),
      );
    }
    if (imageUrl && !endImageUrl) {
      media.push({
        type: 'image_url',
        url: imageUrl,
      });
    } else if (imageUrl && endImageUrl) {
      media.push(
        {
          type: 'first_frame',
          url: imageUrl,
        },
        {
          type: 'last_frame',
          url: endImageUrl,
        },
      );
    }
    if (media.length > 0) {
      input.media = media;
    }
  } else if (model.startsWith('wan2.7')) {
    const media = [];
    if (imageUrl) {
      media.push({
        type: 'first_frame',
        url: imageUrl,
      });
    }
    if (imageUrls && imageUrls.length > 0) {
      imageUrls.forEach((url) =>
        media.push({
          type: 'reference_image',
          url,
        }),
      );
    }
    if (endImageUrl) {
      media.push({
        type: 'last_frame',
        url: endImageUrl,
      });
    }
    if (media.length > 0) {
      input.media = media;
    }
  } else if (matchesModelPattern(model, reference2VideoModels)) {
    if (imageUrl) {
      input.reference_urls = [imageUrl];
    }
    if (imageUrls && imageUrls.length > 0) {
      input.reference_urls = imageUrls;
    }
  } else if (matchesModelPattern(model, keyframe2VideoModels)) {
    if (imageUrl) {
      input.first_frame_url = imageUrl;
    }
    if (endImageUrl) {
      input.last_frame_url = endImageUrl;
    }
  } else if (matchesModelPattern(model, image2VideoModels) && imageUrl) {
    input.img_url = imageUrl;
  }

  // Add prompt to input for all models
  input.prompt = prompt;

  // Add optional parameters
  if (params.aspectRatio) {
    if (model.startsWith('wan2.7')) {
      // Wan2.7 models use "ratio" parameter instead of "aspectRatio"
      parameters.ratio = params.aspectRatio;
    } else {
      parameters.aspectRatio = params.aspectRatio;
    }
  }

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

  if (params.resolution) {
    if (model.startsWith('kling/')) {
      // For Kling models, resolution is determined by mode parameter. Map 1080p to pro mode, others to std mode.
      parameters.mode = params.resolution === '1080p' ? 'pro' : 'std';
    } else {
      parameters.resolution = params.resolution;
    }
  }

  if (params.promptExtend) {
    parameters.prompt_extend = params.promptExtend;
  }

  if (params.watermark) {
    parameters.watermark = params.watermark;
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
 * Create video using Qwen DashScope API
 * Supports three types:
 * - text-to-video (wan2.2-t2v-plus, wanx2.0-t2v-*)
 * - image-to-video (wan2.2-i2v-plus, wanx2.0-i2v-*)
 * - keyframe-to-video (wan2.2-kf2v-flash)
 *
 * Creates a video generation task and returns immediately with inferenceId.
 * The frontend polls the task status using async task polling mechanism.
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

    log('Video task created with id: %s, returning immediately for frontend polling', taskId);

    // Return immediately with inferenceId only
    // Frontend will poll the task status using the async task polling mechanism
    // This avoids blocking the API response for 30+ seconds during server-side polling
    return { inferenceId: taskId };
  } catch (error) {
    log('Error in createQwenVideo: %O', error);

    throw AgentRuntimeError.createVideo({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
