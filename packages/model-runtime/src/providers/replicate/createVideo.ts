import createDebug from 'debug';
import type Replicate from 'replicate';

import type { CreateVideoPayload, CreateVideoResponse, PollVideoStatusResult } from '../../types';

const log = createDebug('lobe-video:replicate');

/**
 * Replicate returns the generated media in a shape that depends on the model:
 * a bare URL string, an array of URL strings, or an object keyed by media type.
 * Normalise all of them to a single URL.
 */
export function extractVideoUrl(output: unknown): string | undefined {
  if (typeof output === 'string') return output || undefined;

  if (Array.isArray(output)) {
    const first = output.find((item) => typeof item === 'string' && item);
    return typeof first === 'string' ? first : undefined;
  }

  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>;

    for (const key of ['video', 'output', 'url']) {
      const nested = record[key];
      if (typeof nested === 'string' && nested) return nested;
      // `video` may itself be a { url } object or an array of URLs
      if (nested && typeof nested === 'object') {
        const resolved = extractVideoUrl(nested);
        if (resolved) return resolved;
      }
    }
  }

  return undefined;
}

/**
 * Replicate types a prediction error as `unknown`: it may be a plain string or
 * an object carrying a `message`.
 */
function extractErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error || undefined;

  if (error && typeof error === 'object') {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string' && message) return message;
  }

  return undefined;
}

/**
 * Submit a video generation prediction to Replicate.
 *
 * Uses `predictions.create` rather than `client.run` so the request returns as
 * soon as the prediction is queued: video generation routinely takes minutes,
 * which does not fit inside a serverless request. The async task pipeline then
 * polls `pollReplicateVideoStatus` until the prediction settles.
 */
export async function createReplicateVideo(
  client: Replicate,
  payload: CreateVideoPayload,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, endImageUrl, aspectRatio, duration, resolution, seed, generateAudio } =
    params;

  const input: Record<string, unknown> = {
    prompt,
    // Replicate defaults this to `true`; generations must stay filtered by default.
    disable_safety_filter: false,
  };

  if (imageUrl) input.image = imageUrl;
  if (endImageUrl) input.last_frame_image = endImageUrl;
  // `aspect_ratio` is ignored by image-to-video models, which derive it from the input image
  if (aspectRatio && !imageUrl) input.aspect_ratio = aspectRatio;
  if (duration !== undefined && duration !== null) input.duration = duration;
  if (resolution) input.resolution = resolution;
  if (seed !== undefined && seed !== null) input.seed = seed;
  if (generateAudio !== undefined) input.save_audio = generateAudio;

  log('Creating video prediction - model: %s, input: %O', model, input);

  const prediction = await client.predictions.create({ input, model });

  if (!prediction?.id) {
    throw new Error('Invalid response from Replicate: missing prediction id');
  }

  log('Video prediction created: %s (status: %s)', prediction.id, prediction.status);

  return { inferenceId: prediction.id };
}

/**
 * Map a Replicate prediction status onto the runtime polling contract.
 */
export async function pollReplicateVideoStatus(
  client: Replicate,
  inferenceId: string,
): Promise<PollVideoStatusResult> {
  const prediction = await client.predictions.get(inferenceId);

  log('Prediction %s status: %s', inferenceId, prediction?.status);

  switch (prediction?.status) {
    case 'succeeded': {
      const videoUrl = extractVideoUrl(prediction.output);

      if (!videoUrl) {
        return { error: 'Prediction succeeded but returned no video URL', status: 'failed' };
      }

      return { status: 'success', videoUrl };
    }

    case 'failed': {
      return {
        error: extractErrorMessage(prediction.error) || 'Video generation failed',
        status: 'failed',
      };
    }

    case 'canceled': {
      return { error: 'Video generation was canceled', status: 'failed' };
    }

    default: {
      return { status: 'pending' };
    }
  }
}
