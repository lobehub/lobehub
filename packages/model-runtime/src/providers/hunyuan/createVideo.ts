import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type {
  CreateVideoPayload,
  CreateVideoResponse,
  PollVideoStatusResult,
} from '../../types/video';

const log = createDebug('lobe-video:hunyuan');
const INFERENCE_ID_SEPARATOR = '::';

interface HunyuanVideoSubmitResponse {
  created_at?: number;
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
  id?: string;
  object?: string;
  request_id?: string;
  status?: string;
}

interface HunyuanVideoQueryResponse {
  completed_at?: number;
  created_at?: number;
  data?: {
    url?: string;
  } | null;
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
  object?: string;
  progress?: number;
  request_id?: string;
  status?: string;
  url?: string;
}

const buildInferenceId = (model: string, taskId: string) =>
  `${model}${INFERENCE_ID_SEPARATOR}${taskId}`;

const parseInferenceId = (inferenceId: string) => {
  const [model, id] = inferenceId.split(INFERENCE_ID_SEPARATOR);
  if (!id) {
    return { model: undefined, id: inferenceId };
  }
  return { model, id };
};

export async function createHunyuanVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { apiKey } = options;
  const { model, params } = payload;
  const { prompt, imageUrl, resolution, watermark } = params;

  const baseURL = options.baseURL || 'https://tokenhub.tencentmaas.com/v1';

  log('Starting Hunyuan video generation with model: %s and params: %O', model, params);

  const requestBody: Record<string, unknown> = {
    model,
    prompt,
    ...(imageUrl ? { image: { url: imageUrl } } : {}),
    ...(resolution && { resolution }),
    ...(watermark && { logo_add: watermark === true ? 1 : 0 }),
  };

  const submitUrl = `${baseURL}/api/video/submit`;
  log('Submitting Hunyuan video task to: %s', submitUrl);
  log('Submit body: %O', requestBody);

  const submitResponse = await fetch(submitUrl, {
    body: JSON.stringify(requestBody),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!submitResponse.ok) {
    let errorData;
    try {
      errorData = await submitResponse.json();
    } catch (error) {
      void error;
    }

    const errorMessage =
      typeof errorData?.error?.message === 'string'
        ? errorData.error.message
        : typeof errorData?.message === 'string'
          ? errorData.message
          : JSON.stringify(errorData || submitResponse.statusText);

    throw new Error(`Hunyuan API video submit error (${submitResponse.status}): ${errorMessage}`);
  }

  const submitData: HunyuanVideoSubmitResponse = await submitResponse.json();
  log('Submit response: %O', submitData);

  if (submitData.error?.message) {
    throw new Error(`Hunyuan API error: ${submitData.error.message}`);
  }

  const taskId = submitData.id;
  if (!taskId) {
    throw new Error(
      `No task id returned from submit endpoint. Response: ${JSON.stringify(submitData)}`,
    );
  }

  const inferenceId = buildInferenceId(model, taskId);
  log('Video task submitted successfully, inferenceId: %s', inferenceId);
  return { inferenceId };
}

export async function queryHunyuanVideoStatus(
  inferenceId: string,
  apiKey: string,
  baseUrl: string,
): Promise<HunyuanVideoQueryResponse> {
  const { model, id } = parseInferenceId(inferenceId);
  const queryUrl = `${baseUrl || 'https://tokenhub.tencentmaas.com/v1'}/api/video/query`;

  log('Querying Hunyuan video status for inferenceId: %s', inferenceId);

  const queryBody: Record<string, unknown> = { id };
  if (model) {
    queryBody.model = model;
  }

  const response = await fetch(queryUrl, {
    body: JSON.stringify(queryBody),
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
    } catch (error) {
      void error;
    }

    const errorMessage =
      typeof errorData?.error?.message === 'string'
        ? errorData.error.message
        : typeof errorData?.message === 'string'
          ? errorData.message
          : JSON.stringify(errorData || response.statusText);

    throw new Error(`Hunyuan API video query error (${response.status}): ${errorMessage}`);
  }

  return response.json();
}

export async function pollHunyuanVideoStatus(
  inferenceId: string,
  apiKey: string,
  baseUrl: string,
): Promise<PollVideoStatusResult> {
  const response = await queryHunyuanVideoStatus(inferenceId, apiKey, baseUrl);

  if (response.error?.message) {
    return { status: 'failed', error: response.error.message };
  }

  const status = response.status;
  if (!status) {
    return { status: 'pending' };
  }

  if (status === 'completed') {
    const videoUrl = response.data?.url || response.url;
    if (!videoUrl) {
      return { status: 'failed', error: 'Video task completed but no URL was returned' };
    }

    return { status: 'success', videoUrl };
  }

  if (status === 'failed') {
    return { status: 'failed', error: 'Video generation failed' };
  }

  return { status: 'pending' };
}
