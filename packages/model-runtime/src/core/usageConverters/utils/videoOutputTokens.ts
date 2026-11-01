import { getVideoReferenceImages, type VideoGenerationParams } from './computeVideoCost';

/** A generated video as billed: its frame size and frame count */
export interface VideoOutputFrames {
  frames: number;
  height: number;
  width: number;
}

interface OutputTokenMeter {
  fps: number;
  /** Output frame size by `${resolution}_${aspectRatio}` */
  frameSizes: Record<string, [width: number, height: number]>;
  /**
   * The output follows the start frame's aspect ratio when only frames are sent (image-to-video),
   * so its size is unknown before the request.
   */
  imageToVideoFollowsStartFrame: boolean;
}

/**
 * Output frame sizes of fal Seedance 2.5 text-to-video and reference-to-video, measured from
 * real outputs and their billed units on 2026-09-30. fal's published table matches except for
 * 480p 16:9/9:16, which render at 854×480 instead of 864×496, and lacks 1080p.
 */
const SEEDANCE_2_5_FRAME_SIZES: OutputTokenMeter['frameSizes'] = {
  '480p_1:1': [640, 640],
  '480p_16:9': [854, 480],
  '480p_21:9': [992, 432],
  '480p_3:4': [560, 752],
  '480p_4:3': [752, 560],
  '480p_9:16': [480, 854],
  '720p_1:1': [960, 960],
  '720p_16:9': [1280, 720],
  '720p_21:9': [1470, 630],
  '720p_3:4': [834, 1112],
  '720p_4:3': [1112, 834],
  '720p_9:16': [720, 1280],
  '1080p_1:1': [1440, 1440],
  '1080p_16:9': [1920, 1080],
  '1080p_21:9': [2206, 946],
  '1080p_3:4': [1248, 1664],
  '1080p_4:3': [1664, 1248],
  '1080p_9:16': [1080, 1920],
};

/**
 * Models billed by output video tokens, keyed by model id. Tokens are
 * `width × height × frames / 1024`, where a video of `d` seconds has `fps × d + 1` frames; this
 * matches fal's billed units for Seedance 2.5 exactly (https://fal.ai/models/bytedance/seedance-2.5/text-to-video).
 */
const OUTPUT_TOKEN_METERS: Record<string, OutputTokenMeter> = {
  'bytedance/seedance-2.5': {
    fps: 24,
    frameSizes: SEEDANCE_2_5_FRAME_SIZES,
    imageToVideoFollowsStartFrame: true,
  },
};

const getMeter = (model: string) =>
  Object.hasOwn(OUTPUT_TOKEN_METERS, model) ? OUTPUT_TOKEN_METERS[model] : undefined;

const toTokens = ({ frames, height, width }: VideoOutputFrames) =>
  Math.floor((width * height * frames) / 1024);

/**
 * Count the output tokens a generated video is billed, or `undefined` when the model is not
 * billed by output tokens.
 */
export const countVideoOutputTokens = (
  model: string,
  output: VideoOutputFrames,
): number | undefined => {
  if (!getMeter(model)) return undefined;
  if (!(output.width > 0 && output.height > 0 && output.frames > 0)) return undefined;
  return toTokens(output);
};

/**
 * Request params the output-token meter reads. Like pricing params, a request must carry them
 * explicitly: an omitted one falls back to a provider default (e.g. fal's `duration: "auto"`)
 * that the meter cannot see.
 */
export const getVideoOutputTokenParamNames = (model: string): string[] =>
  getMeter(model) ? ['aspectRatio', 'duration', 'resolution'] : [];

export interface VideoOutputTokenEstimate {
  /**
   * Output tokens estimated from the resolution's 16:9 frame when the output size follows an
   * input image (the provider keeps the frame area close to it); used to size the hold only
   */
  estimated?: number;
  /** Output tokens known before the request; set when the output size follows the params */
  exact?: number;
}

/**
 * Meter the output tokens of a video request before it runs. Returns `undefined` when the model
 * is not billed by output tokens or the request lacks the duration or resolution.
 */
export const meterVideoOutputTokens = (
  model: string,
  params: VideoGenerationParams & {
    aspectRatio?: unknown;
    endImageUrl?: unknown;
    imageUrl?: unknown;
    imageUrls?: unknown;
  },
): VideoOutputTokenEstimate | undefined => {
  const meter = getMeter(model);
  if (!meter) return undefined;

  const duration = Number(params.duration);
  if (!Number.isFinite(duration) || duration <= 0 || !params.resolution) return undefined;
  const frames = meter.fps * duration + 1;

  const followsStartFrame =
    meter.imageToVideoFollowsStartFrame &&
    getVideoReferenceImages(params).length === 0 &&
    (!!params.imageUrl || !!params.endImageUrl);

  if (followsStartFrame) {
    const nominal = meter.frameSizes[`${params.resolution}_16:9`];
    if (!nominal) return undefined;
    return { estimated: toTokens({ frames, height: nominal[1], width: nominal[0] }) };
  }

  const size = meter.frameSizes[`${params.resolution}_${params.aspectRatio}`];
  if (!size) return undefined;
  return { exact: toTokens({ frames, height: size[1], width: size[0] }) };
};
