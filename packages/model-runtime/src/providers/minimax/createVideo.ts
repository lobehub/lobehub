import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';
import { resolveMappedModelId } from '../../utils/modelIdMapping';

const log = createDebug('lobe-video:minimax');

interface MiniMaxVideoCreateResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  task_id: string;
}

interface MiniMaxH3VideoStatusResponse {
  task?: {
    content?: {
      url?: string;
    };
    error?: { message?: string } | string;
    id: string;
    message?: string;
    model: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'expired';
  };
}

interface MiniMaxVideoStatusResponse {
  base_resp: {
    status_code: number;
    status_msg: string;
  };
  duration?: number;
  file_id?: string;
  status: 'Success' | 'Fail' | 'Preparing' | 'Processing' | 'Queueing';
  task_id: string;
  video_height?: number;
  video_width?: number;
}

interface MiniMaxFileRetrieveResponse {
  base_resp: {
    status_code: number;
    status_msg: string;
  };
  file: {
    bytes: number;
    created_at: number;
    download_url: string;
    file_id: string;
    filename: string;
    purpose: string;
  };
}

const INFERENCE_ID_SEPARATOR = '::';
const MINIMAX_H3_MODEL = 'MiniMax-H3';

const isMiniMaxH3 = (model?: string) => model?.toLowerCase() === MINIMAX_H3_MODEL.toLowerCase();

const buildInferenceId = (model: string, taskId: string) =>
  `${model}${INFERENCE_ID_SEPARATOR}${taskId}`;

const parseInferenceId = (inferenceId: string) => {
  const separatorIndex = inferenceId.indexOf(INFERENCE_ID_SEPARATOR);
  if (separatorIndex === -1) return { id: inferenceId, model: undefined };

  return {
    id: inferenceId.slice(separatorIndex + INFERENCE_ID_SEPARATOR.length),
    model: inferenceId.slice(0, separatorIndex),
  };
};

const resolveMiniMaxV2BaseURL = (baseURL?: string) => {
  const normalizedBaseURL = (baseURL || 'https://api.minimaxi.com/v1').replace(/\/$/, '');

  if (normalizedBaseURL.endsWith('/v2')) return normalizedBaseURL;
  if (normalizedBaseURL.endsWith('/v1')) return `${normalizedBaseURL.slice(0, -3)}/v2`;

  return `${normalizedBaseURL}/v2`;
};

export async function queryMiniMaxVideoStatus(
  taskId: string,
  options: { apiKey: string; baseURL: string },
): Promise<MiniMaxVideoStatusResponse> {
  const statusUrl = `${options.baseURL}/query/video_generation`;
  const urlWithParams = new URL(statusUrl);
  urlWithParams.searchParams.append('task_id', taskId);

  const response = await fetch(urlWithParams.toString(), {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax status API error: ${response.status} ${errorText}`);
  }

  return (await response.json()) as MiniMaxVideoStatusResponse;
}

export async function queryMiniMaxH3VideoStatus(
  taskId: string,
  options: { apiKey: string; baseURL: string },
): Promise<MiniMaxH3VideoStatusResponse> {
  const statusUrl = `${resolveMiniMaxV2BaseURL(options.baseURL)}/query/video_generation/${encodeURIComponent(taskId)}`;

  const response = await fetch(statusUrl, {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax H3 status API error: ${response.status} ${errorText}`);
  }

  return (await response.json()) as MiniMaxH3VideoStatusResponse;
}

export async function retrieveMiniMaxVideoFile(
  fileId: string,
  options: { apiKey: string; baseURL: string },
): Promise<string> {
  const retrieveUrl = `${options.baseURL}/files/retrieve`;
  const urlWithParams = new URL(retrieveUrl);
  urlWithParams.searchParams.append('file_id', fileId);

  const response = await fetch(urlWithParams.toString(), {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax file retrieve API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as MiniMaxFileRetrieveResponse;

  if (data.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax file retrieve error: ${data.base_resp?.status_msg}`);
  }

  if (!data.file?.download_url) {
    throw new Error('Missing download_url in MiniMax file retrieve response');
  }

  return data.file.download_url;
}

export async function pollMiniMaxVideoStatus(
  inferenceId: string,
  options: { apiKey: string; baseURL: string },
): Promise<
  | { status: 'success'; videoUrl: string }
  | { status: 'failed'; error: string }
  | { status: 'pending' }
> {
  const { id: taskId, model } = parseInferenceId(inferenceId);

  if (isMiniMaxH3(model)) {
    const response = await queryMiniMaxH3VideoStatus(taskId, options);
    const task = response.task;

    if (!task) return { error: 'Missing task in MiniMax H3 status response', status: 'failed' };

    if (task.status === 'succeeded') {
      if (!task.content?.url) {
        return { error: 'Task succeeded but no video URL found', status: 'failed' };
      }

      return { status: 'success', videoUrl: task.content.url };
    }

    if (task.status === 'failed' || task.status === 'expired') {
      const taskError =
        typeof task.error === 'string' ? task.error : task.error?.message || task.message;
      return {
        error: taskError || `Video generation ${task.status}`,
        status: 'failed',
      };
    }

    return { status: 'pending' };
  }

  const response = await queryMiniMaxVideoStatus(taskId, options);

  if (response.status === 'Success') {
    const fileId = response.file_id;
    if (!fileId) {
      return { error: 'Task succeeded but no file_id found', status: 'failed' };
    }

    try {
      const videoUrl = await retrieveMiniMaxVideoFile(fileId, options);
      return { status: 'success', videoUrl };
    } catch (error) {
      return {
        error: `Failed to retrieve video file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        status: 'failed',
      };
    }
  }

  if (response.status === 'Fail') {
    return { error: response.base_resp?.status_msg || 'Video generation failed', status: 'failed' };
  }

  return { status: 'pending' };
}

export async function createMiniMaxVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const requestModel = resolveMappedModelId(model, options);
  const { prompt, imageUrl, imageUrls, endImageUrl, aspectRatio, duration, resolution } = params;

  const baseURL = options.baseURL || 'https://api.minimaxi.com/v1';

  if (isMiniMaxH3(model) || isMiniMaxH3(requestModel)) {
    const content: Record<string, unknown>[] = [{ text: prompt, type: 'text' }];
    const hasReferenceImages = Boolean(imageUrls?.length);
    const referenceImageUrls = hasReferenceImages
      ? [imageUrl, ...(imageUrls ?? []), endImageUrl].filter(
          (url): url is string => typeof url === 'string' && url.length > 0,
        )
      : [];

    if (referenceImageUrls.length > 9) {
      throw new Error('MiniMax-H3 supports up to 9 reference images');
    }

    if (hasReferenceImages) {
      referenceImageUrls.forEach((url) =>
        content.push({
          image_url: { url },
          role: 'reference_image',
          type: 'image_url',
        }),
      );
    } else if (imageUrl) {
      content.push({
        image_url: { url: imageUrl },
        role: 'first_frame',
        type: 'image_url',
      });
    }

    if (!hasReferenceImages && endImageUrl) {
      content.push({
        image_url: { url: endImageUrl },
        role: 'last_frame',
        type: 'image_url',
      });
    }

    const body: Record<string, unknown> = {
      aigc_watermark: params.watermark ?? false,
      content,
      model: requestModel,
      ratio: !hasReferenceImages && (imageUrl || endImageUrl) ? 'adaptive' : aspectRatio || '16:9',
      ...(typeof duration === 'number' ? { duration } : {}),
      ...(typeof resolution === 'string' ? { resolution } : {}),
    };

    log('Creating video with MiniMax H3 API - model: %s, params: %O', model, params);

    const response = await fetch(`${resolveMiniMaxV2BaseURL(baseURL)}/video_generation`, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax H3 video API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as MiniMaxVideoCreateResponse;

    if (data.base_resp && data.base_resp.status_code !== 0) {
      throw new Error(`MiniMax H3 video API error: ${data.base_resp.status_msg}`);
    }

    if (!data.task_id) throw new Error('Invalid response: missing task_id');

    return { inferenceId: buildInferenceId(MINIMAX_H3_MODEL, data.task_id) };
  }

  const body: Record<string, unknown> = {
    model: requestModel,
    prompt,
    aigc_watermark: params.watermark ?? false,
    prompt_optimizer: params.promptExtend ?? false,
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(typeof resolution === 'string' ? { resolution } : {}),
  };

  if (imageUrl) {
    // For S2V-01 model, the image is treated as subject reference and included in the prompt.
    if (model === 'S2V-01') {
      body.subject_reference = [
        {
          type: 'character',
          image: [imageUrl],
        },
      ];
    } else {
      // For other models, the image is treated as the first frame of the video.
      body.first_frame_image = imageUrl;
    }
  }
  if (endImageUrl) {
    body.last_frame_image = endImageUrl;
  }

  log('Creating video with MiniMax API - model: %s, params: %O', model, params);

  const response = await fetch(`${baseURL}/video_generation`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax video API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as MiniMaxVideoCreateResponse;

  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax video API error: ${data.base_resp.status_msg}`);
  }

  if (!data.task_id) {
    throw new Error('Invalid response: missing task_id');
  }

  return { inferenceId: data.task_id };
}
