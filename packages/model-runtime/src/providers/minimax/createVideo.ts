import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';

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

async function queryVideoStatus(
  taskId: string,
  options: { apiKey: string; baseURL: string },
): Promise<MiniMaxVideoStatusResponse> {
  const statusUrl = `${options.baseURL}/query/video_generation`;

  log('Querying video status for task: %s', taskId);

  const urlWithParams = new URL(statusUrl);
  urlWithParams.searchParams.append('task_id', taskId);

  const responseWithParams = await fetch(urlWithParams.toString(), {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    method: 'GET',
  });

  if (!responseWithParams.ok) {
    const errorText = await responseWithParams.text();
    throw new Error(`MiniMax status API error: ${responseWithParams.status} ${errorText}`);
  }

  const data = (await responseWithParams.json()) as MiniMaxVideoStatusResponse;
  log('Video status response: %O', data);

  return data;
}

async function retrieveVideoFile(
  fileId: string,
  options: { apiKey: string; baseURL: string },
): Promise<string> {
  const retrieveUrl = `${options.baseURL}/files/retrieve`;
  const urlWithParams = new URL(retrieveUrl);
  urlWithParams.searchParams.append('file_id', fileId);

  log('Retrieving video file: %s', fileId);

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
  log('File retrieve response: %O', data);

  if (data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax file retrieve error: ${data.base_resp.status_msg}`);
  }

  if (!data.file?.download_url) {
    throw new Error('Missing download_url in file retrieve response');
  }

  return data.file.download_url;
}

export async function createMiniMaxVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, endImageUrl, duration } = params;

  log('Creating video with MiniMax API - model: %s, params: %O', model, params);

  const baseURL = options.baseURL || 'https://api.minimaxi.com/v1';

  const body: Record<string, unknown> = {
    duration: duration || 6,
    model,
    prompt,
    resolution: '1080P',
  };

  if (imageUrl) {
    body.first_frame_image = imageUrl;
  }
  if (endImageUrl) {
    body.last_frame_image = endImageUrl;
  }

  log('MiniMax video API request body: %O', body);

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
    log('MiniMax video API error: %s %s', response.status, errorText);
    throw new Error(`MiniMax video API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as MiniMaxVideoCreateResponse;
  log('MiniMax video API response: %O', data);

  if (data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax video API error: ${data.base_resp.status_msg}`);
  }

  if (!data.task_id) {
    throw new Error('Invalid response: missing task_id');
  }

  const taskId = data.task_id;
  log('Video task created with id: %s, starting polling...', taskId);

  const fileId = await asyncifyPolling<MiniMaxVideoStatusResponse, string>({
    checkStatus: (statusResponse: MiniMaxVideoStatusResponse): TaskResult<string> => {
      log('Task %s status: %s', taskId, statusResponse.status);

      if (statusResponse.status === 'Success') {
        if (!statusResponse.file_id) {
          log('Task succeeded but missing file_id in response');
          return {
            error: new Error('Missing file_id in success response'),
            status: 'failed',
          };
        }
        log('Video generation succeeded, file_id: %s', statusResponse.file_id);

        return {
          data: statusResponse.file_id,
          status: 'success',
        };
      }

      if (statusResponse.status === 'Fail') {
        log('Video generation failed: %s', taskId);
        return {
          error: new Error('Video generation failed'),
          status: 'failed',
        };
      }

      // Continue polling for Processing, Queued, or other statuses
      log('Video generation in progress: %s (status: %s)', taskId, statusResponse.status);

      return { status: 'pending' };
    },
    initialInterval: 10000, // MiniMax recommends 10s polling interval
    logger: {
      debug: (message: any, ...args: any[]) => log(message, ...args),
      error: (message: any, ...args: any[]) => log(message, ...args),
    },
    maxInterval: 15000,
    maxRetries: 60, // Max 15 minutes (60 * 15s = 900s)
    pollingQuery: () => queryVideoStatus(taskId, { apiKey: options.apiKey, baseURL }),
  });

  log('Video generation completed, file_id: %s, retrieving download URL...', fileId);

  // Step 3: Retrieve the download URL
  const videoUrl = await retrieveVideoFile(fileId, { apiKey: options.apiKey, baseURL });

  log('Video download URL retrieved successfully: %s', videoUrl);

  return {
    inferenceId: taskId,
    videoUrl,
  };
}
