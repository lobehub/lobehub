import type { RuntimeImageGenParams } from 'model-bank';

/**
 * LobeHub standard parameter -> WaveSpeed request field.
 *
 * Anything not listed here is forwarded under its own name, so model-specific
 * fields declared on a model card reach the API untouched.
 */
const PARAMS_MAP = new Map<string, string>([
  ['aspectRatio', 'aspect_ratio'],
  ['imageUrl', 'image'],
  ['imageUrls', 'images'],
  ['endImageUrl', 'last_image'],
  ['generateAudio', 'generate_audio'],
  ['promptExtend', 'enable_prompt_expansion'],
  ['cameraFixed', 'camera_fixed'],
  ['webSearch', 'enable_web_search'],
  ['negativePrompt', 'negative_prompt'],
]);

const isEmpty = (value: unknown) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/**
 * WaveSpeed expresses explicit dimensions as `{width}*{height}`, while the
 * LobeHub standard `size` parameter uses `{width}x{height}`.
 */
const normalizeSize = (size: string) => size.replace('x', '*');

/**
 * Translate LobeHub standard generation parameters into a WaveSpeed request
 * body. Empty values are dropped so the model's own server-side defaults win
 * instead of being overwritten with nulls.
 */
export const buildRequestBody = (
  params: RuntimeImageGenParams | Record<string, unknown>,
): Record<string, unknown> => {
  const body: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (isEmpty(value)) continue;

    const mappedKey = PARAMS_MAP.get(key) ?? key;

    body[mappedKey] =
      mappedKey === 'size' && typeof value === 'string' ? normalizeSize(value) : value;
  }

  // `width`/`height` are only meaningful to WaveSpeed as a combined `size`.
  if (typeof body.width === 'number' && typeof body.height === 'number' && !body.size) {
    body.size = `${body.width}*${body.height}`;
    delete body.width;
    delete body.height;
  }

  return body;
};
