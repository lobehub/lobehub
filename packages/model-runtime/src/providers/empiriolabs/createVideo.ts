import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatible';
import type {
  CreateVideoPayload,
  CreateVideoResult,
  PollVideoStatusResult,
} from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';
import { videoAudioFields } from './videoAudioFields';

const log = createDebug('lobe-video:empiriolabs');

const EMPIRIOLABS_BASE_URL = 'https://api.empiriolabs.ai/v1';

/**
 * EmpirioLabs AI async video job submit response.
 * POST /v1/videos/generations -> { job_id, status, poll_url }
 * @see https://docs.empiriolabs.ai/api-reference/api-reference/videos/create-video
 */
interface EmpirioLabsVideoSubmitResponse {
  job_id?: string;
  poll_url?: string;
  status?: string;
}

/**
 * EmpirioLabs AI async job status response.
 * GET /v1/jobs/{job_id} -> { job_id, status, result?, error? }
 *
 * `status` is one of "processing", "completed", "failed" or "cancelled". A
 * completed job carries the video URL in `result.data[]`; a failed job
 * carries `error` as `{ message, type, param, code }`.
 * @see https://docs.empiriolabs.ai/api-reference/api-reference/jobs/retrieve-job
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
 * Build the EmpirioLabs AI request body from the runtime video parameters.
 * The runtime forwards camelCase keys; the API reads snake_case, so the
 * mapping happens here. Only parameters declared on each model card reach
 * this function, so every key below maps to a field the API reads.
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

  // Image-to-video and reference inputs: `image` is the first frame,
  // `image_end` an optional last frame, and `reference_images` the inputs of
  // multi-image reference-to-video.
  if (imageUrl) body.image = imageUrl;
  if (endImageUrl) body.image_end = endImageUrl;
  if (imageUrls && imageUrls.length > 0) body.reference_images = imageUrls;

  if (resolution) body.resolution = resolution;
  // Models that take a width x height string read it as their resolution.
  if (size && resolution === undefined) body.resolution = size;
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (duration !== undefined && duration !== null) body.duration = duration;

  // The audio switch has a different name on some models.
  if (generateAudio !== undefined) {
    body[videoAudioFields[model] ?? 'generate_audio'] = generateAudio;
  }

  if (promptExtend !== undefined) body.prompt_extend = promptExtend;
  if (watermark !== undefined) body.watermark = watermark;
  if (seed !== undefined && seed !== null) body.seed = seed;

  return body;
}

/**
 * Create an EmpirioLabs AI video generation job.
 *
 * Video generation is async: the submit call returns a `job_id` at once and
 * the result is read from `/v1/jobs/{id}`. The `job_id` is returned as the
 * inferenceId so the runtime's polling drives the rest through
 * `pollEmpirioLabsVideoStatus`.
 */
export async function createEmpirioLabsVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResult> {
  const { apiKey, baseURL, provider } = options;
  const { model } = payload;

  const url = `${baseURL || EMPIRIOLABS_BASE_URL}/videos/generations`;
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
      log('EmpirioLabs AI video submit error: %s %s', response.status, errorText);
      throw new Error(`EmpirioLabs AI video API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as EmpirioLabsVideoSubmitResponse;
    log('EmpirioLabs AI video submit response: %O', data);

    if (!data?.job_id) {
      throw new Error('Invalid response: missing job_id');
    }

    log('Video job created with id: %s, returning for polling', data.job_id);

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
 * Read the status of an EmpirioLabs AI video job and return the standardized
 * result the runtime expects.
 */
export async function pollEmpirioLabsVideoStatus(
  jobId: string,
  options: { apiKey: string; baseURL?: string | null },
): Promise<PollVideoStatusResult> {
  const url = `${options.baseURL || EMPIRIOLABS_BASE_URL}/jobs/${jobId}`;

  log('Querying video job status for: %s', jobId);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`EmpirioLabs AI job status API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as EmpirioLabsJobStatusResponse;
  log('Video job status response: %O', data);

  const status = data.status;

  if (status === 'completed') {
    const videoUrl = data.result?.data?.find((item) => item?.url)?.url;
    if (!videoUrl) {
      return { error: 'Job completed but no video URL found', status: 'failed' };
    }
    // The returned media URL can be fetched as is, so no auth headers are added.
    return { status: 'success', videoUrl };
  }

  if (status === 'failed') {
    return { error: data.error?.message || 'Video generation failed', status: 'failed' };
  }

  // A cancelled job never completes, so polling must stop.
  if (status === 'cancelled') {
    return { error: 'Video generation was cancelled', status: 'failed' };
  }

  // "processing" means the job is still running.
  return { status: 'pending' };
}
