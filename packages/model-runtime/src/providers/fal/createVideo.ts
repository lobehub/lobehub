import type { FalClient } from '@fal-ai/client';
import debug from 'debug';
import type { RuntimeVideoGenParams } from 'model-bank';

import type { CreateVideoResult, PollVideoStatusResult } from '../../types/video';

const log = debug('lobe-video:fal');

/**
 * Video model cards that map to one fal app with a separate endpoint per task. The runtime picks
 * the endpoint from the request params, so the user sees a single model.
 */
const TASK_ROUTED_VIDEO_MODELS = new Set(['minimax/h3-max']);

/**
 * fal queue requests live at `<owner>/<app>/requests/<id>`. Using that path as the inference id
 * keeps polling self-contained: the router polls with the inference id only, and the status and
 * result endpoints need the app id, not the task endpoint.
 */
const REQUEST_PATH_SEPARATOR = '/requests/';

export const isFalVideoModel = (model: string) => TASK_ROUTED_VIDEO_MODELS.has(model);

export const toFalVideoInferenceId = (appId: string, requestId: string) =>
  `${appId}${REQUEST_PATH_SEPARATOR}${requestId}`;

export const parseFalVideoInferenceId = (inferenceId: string) => {
  const index = inferenceId.lastIndexOf(REQUEST_PATH_SEPARATOR);
  if (index <= 0) throw new Error(`Invalid fal video inference id: ${inferenceId}`);

  return {
    appId: inferenceId.slice(0, index),
    requestId: inferenceId.slice(index + REQUEST_PATH_SEPARATOR.length),
  };
};

/**
 * Build the fal endpoint and input for a task-routed video model:
 * - reference images → `/reference-to-video`; first/last frames join the reference pool (the
 *   endpoint has no frame slots), matching how MiniMax H3 is served by its official API
 * - first or last frame → `/image-to-video`, whose output follows the first frame's aspect ratio
 * - otherwise → `/text-to-video`
 */
export const buildFalVideoRequest = (model: string, params: RuntimeVideoGenParams) => {
  const {
    aspectRatio,
    duration,
    endImageUrl,
    imageUrl,
    imageUrls,
    prompt,
    promptExtend,
    resolution,
    seed,
  } = params;

  const input: Record<string, unknown> = {
    enable_safety_checker: false,
    prompt,
    // Required by fal; the model card exposes the three modes through `promptExtend`.
    prompt_expansion_mode: typeof promptExtend === 'string' ? promptExtend : 'balanced',
  };
  if (duration) input.duration = duration;
  if (resolution) input.resolution = resolution;
  if (typeof seed === 'number' && seed >= 0) input.seed = seed;

  let task: 'image-to-video' | 'reference-to-video' | 'text-to-video';
  if (imageUrls?.length) {
    task = 'reference-to-video';
    input.reference_image_urls = [imageUrl, ...imageUrls, endImageUrl].filter(
      (url): url is string => !!url,
    );
    if (aspectRatio) input.aspect_ratio = aspectRatio;
  } else if (imageUrl || endImageUrl) {
    task = 'image-to-video';
    if (imageUrl) input.image_url = imageUrl;
    if (endImageUrl) input.end_image_url = endImageUrl;
  } else {
    task = 'text-to-video';
    if (aspectRatio) input.aspect_ratio = aspectRatio;
  }

  return { endpoint: `${model}/${task}`, input };
};

const getFalErrorMessage = (error: unknown): string => {
  const detail = (error as { body?: { detail?: unknown } } | undefined)?.body?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item as { msg?: unknown } | undefined)?.msg)
      .filter((msg): msg is string => typeof msg === 'string');
    if (messages.length > 0) return messages.join('; ');
  }

  return error instanceof Error ? error.message : String(error);
};

export const createFalVideo = async (
  client: FalClient,
  model: string,
  params: RuntimeVideoGenParams,
): Promise<CreateVideoResult> => {
  const { endpoint, input } = buildFalVideoRequest(model, params);
  log('Submitting fal video request to %s with input: %O', endpoint, input);

  const { request_id } = await client.queue.submit(endpoint, { input });

  return { inferenceId: toFalVideoInferenceId(model, request_id) };
};

export const pollFalVideoStatus = async (
  client: FalClient,
  inferenceId: string,
): Promise<PollVideoStatusResult> => {
  const { appId, requestId } = parseFalVideoInferenceId(inferenceId);

  const status = await client.queue.status(appId, { logs: false, requestId });
  if (status.status !== 'COMPLETED') return { status: 'pending' };

  // A failed request also reaches COMPLETED; fetching its result throws the provider error.
  let data: unknown;
  try {
    ({ data } = await client.queue.result(appId, { requestId }));
  } catch (error) {
    log('fal video request %s failed: %O', inferenceId, error);
    return { error: getFalErrorMessage(error), status: 'failed' };
  }

  const videoUrl = (data as { video?: { url?: string } } | undefined)?.video?.url;
  if (!videoUrl) return { error: 'fal returned no video', status: 'failed' };

  return { status: 'success', videoUrl };
};
