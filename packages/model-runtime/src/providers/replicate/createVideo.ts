import createDebug from 'debug';
import type { RuntimeVideoGenParams } from 'model-bank';
import type Replicate from 'replicate';

import type { CreateVideoPayload, CreateVideoResponse, PollVideoStatusResult } from '../../types';

const log = createDebug('lobe-video:replicate');

type StandardParam = keyof RuntimeVideoGenParams;

interface ReplicateVideoModel {
  /**
   * Standard parameter -> Replicate input name. Acts as an allow list: a
   * parameter with no entry here is not sent, so a card cannot leak an input
   * name the model does not declare.
   */
  aliases: Partial<Record<StandardParam, string>>;
  /** Inputs always sent, whatever the user selected. */
  fixedInput?: Record<string, unknown>;
  /** Parameters the model derives from the input image and ignores alongside it. */
  ignoredWithImage?: StandardParam[];
}

/**
 * Per-model input contracts, transcribed from each model's OpenAPI schema.
 * Replicate input names are model-specific, so they belong here rather than in
 * the generic submission path below.
 */
const VIDEO_MODELS: Record<string, ReplicateVideoModel> = {
  'prunaai/p-video': {
    aliases: {
      aspectRatio: 'aspect_ratio',
      duration: 'duration',
      endImageUrl: 'last_frame_image',
      imageUrl: 'image',
      prompt: 'prompt',
      resolution: 'resolution',
      seed: 'seed',
    },
    // Replicate defaults this to `true`; keep generations filtered.
    fixedInput: { disable_safety_filter: false },
    ignoredWithImage: ['aspectRatio'],
  },
};

const DEFAULT_MODEL: ReplicateVideoModel = {
  aliases: {
    aspectRatio: 'aspect_ratio',
    duration: 'duration',
    imageUrl: 'image',
    prompt: 'prompt',
    resolution: 'resolution',
    seed: 'seed',
  },
};

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);

export function buildVideoInput(model: string, params: RuntimeVideoGenParams) {
  // Strip any `:version` suffix so a pinned version still resolves its contract
  const [modelId] = model.split(':');
  const config = VIDEO_MODELS[modelId] ?? DEFAULT_MODEL;

  const input: Record<string, unknown> = { ...config.fixedInput };

  for (const [key, value] of Object.entries(params) as [StandardParam, unknown][]) {
    const alias = config.aliases[key];
    if (!alias || isEmpty(value)) continue;
    if (params.imageUrl && config.ignoredWithImage?.includes(key)) continue;

    input[alias] = value;
  }

  return input;
}

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

  const input = buildVideoInput(model, params);

  log('Creating video prediction - model: %s, input: %O', model, input);

  // Replicate exposes two prediction endpoints: `POST /predictions`, which takes
  // a `version` and accepts any model, and `POST /models/{owner}/{name}/predictions`,
  // which takes a bare model id but only serves official models. A pinned version
  // cannot go through the latter, since it would land in the URL path.
  const prediction = model.includes(':')
    ? await client.predictions.create({ input, version: model })
    : await client.predictions.create({ input, model });

  if (!prediction?.id) {
    throw new Error('Invalid response from Replicate: missing prediction id');
  }

  log('Video prediction created: %s (status: %s)', prediction.id, prediction.status);

  return { inferenceId: prediction.id };
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
 * Map a Replicate prediction status onto the runtime polling contract.
 */
export async function pollReplicateVideoStatus(
  client: Replicate,
  inferenceId: string,
): Promise<PollVideoStatusResult> {
  const prediction = await client.predictions.get(inferenceId);

  log('Prediction %s status: %s', inferenceId, prediction?.status);

  // `aborted` is missing from the installed SDK's `Status` union but the API
  // does return it, so widen before matching to keep it reachable.
  const status: string | undefined = prediction?.status;

  switch (status) {
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

    // Terminal: the prediction hit its deadline before it ever started running.
    // Reporting it as pending would burn the caller's full polling budget first.
    case 'aborted': {
      return { error: 'Video generation was aborted before it started', status: 'failed' };
    }

    default: {
      return { status: 'pending' };
    }
  }
}
