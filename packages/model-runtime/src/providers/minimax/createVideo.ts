import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';

const log = createDebug('lobe-video:minimax');

interface MiniMaxVideoCreateResponse {
  base_resp: {
    status_code: number;
    status_msg: string;
  };
  task_id: string;
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
  taskId: string,
  options: { apiKey: string; baseURL: string },
): Promise<
  | { status: 'success'; videoUrl: string }
  | { status: 'failed'; error: string }
  | { status: 'pending' }
> {
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
  const { prompt, imageUrl, endImageUrl, duration, resolution } = params;

  const baseURL = options.baseURL || 'https://api.minimaxi.com/v1';

  const body: Record<string, unknown> = {
    model,
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

  if (data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax video API error: ${data.base_resp.status_msg}`);
  }

  if (!data.task_id) {
    throw new Error('Invalid response: missing task_id');
  }

  return { inferenceId: data.task_id };
}
