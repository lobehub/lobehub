import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type {
  CreateVideoPayload,
  CreateVideoResponse,
  PollVideoStatusResult,
} from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-video:empiriolabs');

/**
 * EmpirioLabs async video job submit response.
 * POST /v1/videos/generations -> { job_id, status, poll_url }
 */
interface EmpirioLabsVideoSubmitResponse {
  job_id?: string;
  poll_url?: string;
  status?: string;
}

/**
 * EmpirioLabs async job status response.
 * GET /v1/jobs/{job_id} -> { job_id, status, result?, error? }
 *
 * Terminal success: status is "completed" or "succeeded" and `result.data[]`
 * carries the signed video URL. Terminal failure: status is "failed" and
 * `error` is `{ message, type, code }`. Anything else (queued / processing /
 * running) means the job is still in flight.
 */
interface EmpirioLabsJobStatusResponse {
  error?: {
    code?: number | string;
    message?: string;
    type?: string;
  };
  job_id?: string;
  result?: {
    data?: Array<{ url?: string }>;
  };
  status?: string;
}

/**
 * Build the EmpirioLabs worker request body from LobeChat's runtime video
 * parameters. LobeChat forwards camelCase keys; the EmpirioLabs workers read
 * snake_case, so the mapping happens here (the same split the Qwen provider
 * uses for DashScope). Only parameters declared on each model card reach this
 * function, so every key below maps to a field the worker actually reads.
 */
function buildVideoBody(payload: CreateVideoPayload): Record<string, unknown> {
  const { model, params } = payload;
  const {
    prompt,
    imageUrl,
    imageUrls,
    endImageUrl,
    aspectRatio,
    resolution,
    size,
    duration,
    generateAudio,
    promptExtend,
    watermark,
    seed,
  } = params;

  const body: Record<string, unknown> = { model, prompt };

  // Image-to-video / reference inputs. The workers accept `image` for the
  // primary source frame, `image_end` for an optional tail frame, and
  // `reference_images` for multi-image reference-to-video.
  if (imageUrl) body.image = imageUrl;
  if (endImageUrl) body.image_end = endImageUrl;
  if (imageUrls && imageUrls.length > 0) body.reference_images = imageUrls;

  if (resolution) body.resolution = resolution;
  // svi-2-0-pro takes a width x height size string as its resolution input.
  if (size && resolution === undefined) body.resolution = size;
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (duration !== undefined && duration !== null) body.duration = duration;

  // Audio toggle. The workers that expose it read `generate_audio`.
  if (generateAudio !== undefined) body.generate_audio = generateAudio;

  if (promptExtend !== undefined) body.prompt_extend = promptExtend;
  if (watermark !== undefined) body.watermark = watermark;
  if (seed !== undefined && seed !== null) body.seed = seed;

  return body;
}

/**
 * Create an EmpirioLabs video generation job.
 *
 * EmpirioLabs video generation is fully async: the submit call returns a
 * `job_id` immediately and the result is fetched by polling `/v1/jobs/{id}`.
 * Return the `job_id` as the inferenceId so the runtime's async polling
 * mechanism drives the rest through `pollEmpirioLabsVideoStatus`.
 */
export async function createEmpirioLabsVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { apiKey, baseURL, provider } = options;
  const { model } = payload;

  const url = `${baseURL || 'https://api.empiriolabs.ai/v1'}/videos/generations`;
  const body = buildVideoBody(payload);

  log('Creating video job with model: %s, body: %O', model, body);

  try {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const errorText = await response.text();
      log('EmpirioLabs video submit error: %s %s', response.status, errorText);
      throw new Error(`EmpirioLabs video API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as EmpirioLabsVideoSubmitResponse;
    log('EmpirioLabs video submit response: %O', data);

    if (!data?.job_id) {
      throw new Error('Invalid response: missing job_id');
    }

    log('Video job created with id: %s, returning for frontend polling', data.job_id);

    // Return immediately with the job id; the runtime polls for completion.
    return { inferenceId: data.job_id };
  } catch (error) {
    log('Error in createEmpirioLabsVideo: %O', error);

    throw AgentRuntimeError.createVideo({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}

/**
 * Poll the status of an EmpirioLabs video job and return the standardized
 * result the runtime expects.
 */
export async function pollEmpirioLabsVideoStatus(
  jobId: string,
  apiKey: string,
  baseURL: string,
): Promise<PollVideoStatusResult> {
  const url = `${baseURL || 'https://api.empiriolabs.ai/v1'}/jobs/${jobId}`;

  log('Querying video job status for: %s', jobId);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`EmpirioLabs job status API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as EmpirioLabsJobStatusResponse;
  log('Video job status response: %O', data);

  const status = data.status;

  if (status === 'completed' || status === 'succeeded') {
    const videoUrl = data.result?.data?.find((item) => item?.url)?.url;
    if (!videoUrl) {
      return { error: 'Job completed but no video URL found', status: 'failed' };
    }
    // The signed media URL is already publicly fetchable, so no auth headers.
    return { status: 'success', videoUrl };
  }

  if (status === 'failed') {
    return { error: data.error?.message || 'Video generation failed', status: 'failed' };
  }

  // queued, processing, running, or any other status means still pending.
  return { status: 'pending' };
}
