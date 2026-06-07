import createDebug from 'debug';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';

const log = createDebug('lobe-video:aihubmix');

// ---------------------------------------------------------------------------
// Model-family helpers
// ---------------------------------------------------------------------------

const SEEDANCE_PREFIX = 'doubao-seedance';

const isSeedance = (model: string) => model.startsWith(SEEDANCE_PREFIX);

// ---------------------------------------------------------------------------
// Resolution × aspect-ratio → pixel size
// AiHubMix only reliably accepts pixel formats ("1280x720", "960x960").
// Ratio labels ("16:9") and resolution labels ("720p", "1080p") are NOT
// respected by Wan models and Seedance — only Veo accepts them.
// We always resolve to pixel format when possible.
// ---------------------------------------------------------------------------

const RESOLUTION_MAP: Record<string, Record<string, string>> = {
  '480p': {
    '16:9': '832x480',
    '9:16': '480x832',
    '1:1': '624x624',
    '4:3': '832x624',
    '3:4': '624x832',
  },
  '720p': {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '960x960',
    '4:3': '1088x832',
    '3:4': '832x1088',
  },
  '1080p': {
    '16:9': '1920x1080',
    '9:16': '1080x1920',
    '1:1': '1440x1440',
    '4:3': '1632x1248',
    '3:4': '1248x1632',
  },
};

/** Default aspect ratio used when resolution is set but aspectRatio is not. */
const DEFAULT_ASPECT_RATIO = '16:9';

/**
 * Normalise the resolution string that may come from model-bank.
 * Model cards use both `"1080P"` (uppercase) and `"1080p"` (lowercase).
 */
const normalizeResolution = (r: string): string => r.toLowerCase();

/**
 * Resolve resolution + aspectRatio into an AiHubMix-compatible `size` value.
 *
 * Always tries to produce a pixel format (e.g. "1920x1080") because that is
 * the only format accepted by ALL model families on AiHubMix.
 *
 * Priority:
 *  1. Both given → exact pixel format (e.g. "1920x1080")
 *  2. Resolution only → pixel format with default 16:9 ratio (e.g. "1280x720")
 *  3. Aspect ratio only → pass as-is (e.g. "16:9") – best-effort
 *  4. Neither → undefined (omit from request)
 */
function resolveSize(resolution?: string, aspectRatio?: string): string | undefined {
  if (resolution) {
    const norm = normalizeResolution(resolution);
    const ratio = aspectRatio || DEFAULT_ASPECT_RATIO;
    return RESOLUTION_MAP[norm]?.[ratio] ?? norm;
  }
  if (aspectRatio) return aspectRatio;
  return undefined;
}

// ---------------------------------------------------------------------------
// Seedance extra_body builder
// AiHubMix Seedance uses `extra_body.content[]` for multi-modal references
// and `extra_body.ratio` / `extra_body.watermark` / `extra_body.seed` for
// additional controls.  Note: output resolution is controlled by the top-level
// `size` parameter (pixel format), and duration by top-level `seconds` —
// neither is read from extra_body despite what the docs suggest.
// ---------------------------------------------------------------------------

interface ContentRef {
  image_url: { url: string };
  role: 'reference_image';
  type: 'image_url';
}

interface ExtraBody {
  content?: ContentRef[];
  generate_audio?: boolean;
  ratio?: string;
  seed?: number | null;
  watermark?: boolean;
}

function buildSeedanceExtraBody(params: CreateVideoPayload['params']): ExtraBody | undefined {
  const { aspectRatio, generateAudio, imageUrls, endImageUrl, seed, watermark } = params;

  const hasContent = (imageUrls && imageUrls.length > 0) || endImageUrl;
  const content: ContentRef[] = [];

  if (imageUrls?.length) {
    for (const url of imageUrls) {
      content.push({ image_url: { url }, role: 'reference_image', type: 'image_url' });
    }
  }

  if (endImageUrl) {
    content.push({ image_url: { url: endImageUrl }, role: 'reference_image', type: 'image_url' });
  }

  const extra: ExtraBody = {};

  if (content.length > 0) extra.content = content;
  if (aspectRatio) extra.ratio = aspectRatio;
  if (generateAudio !== undefined) extra.generate_audio = generateAudio;
  if (seed !== undefined && seed !== null) extra.seed = seed;
  if (watermark !== undefined) extra.watermark = watermark;

  // Return undefined when there is nothing to send
  return Object.keys(extra).length > 0 ? extra : undefined;
}

// ---------------------------------------------------------------------------
// createAiHubMixVideo
// AiHubMix exposes a unified `/v1/videos` endpoint compatible with the
// OpenAI Sora format.  This function maps the full RuntimeVideoGenParams
// surface onto that single endpoint, handling model-specific differences
// (e.g. Seedance's `extra_body`) transparently.
// ---------------------------------------------------------------------------

export async function createAiHubMixVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, duration, imageUrl, imageUrls, aspectRatio, resolution, seed, watermark } =
    params;

  log('Creating video with AiHubMix - model: %s, params: %O', model, params);
  log('resolution: %s | aspectRatio: %s', resolution, aspectRatio);

  const baseURL = options.baseURL || 'https://aihubmix.com/v1';

  // ---- Base body (works for all model families) ----
  const body: Record<string, unknown> = {
    model,
    prompt,
  };

  // Duration: pass as top-level `seconds` (string) for all models including
  // Seedance.  Verified against the live API: Seedance ignores
  // extra_body.duration — only top-level `seconds` controls the output
  // duration, same as Wan/Veo/Sora.
  if (duration !== undefined && duration !== null) {
    body['seconds'] = duration.toString();
  }

  // Size: resolve from resolution + aspectRatio into pixel format.
  // All model families (including Seedance) accept the top-level `size`
  // parameter with pixel values like "624x832".  Tested against the live API:
  // Seedance ignores extra_body.resolution for actual output size — only
  // top-level `size` in pixel format controls the output resolution.
  {
    const size = resolveSize(resolution, aspectRatio);
    log('resolveSize result: %s', size);
    if (size) body['size'] = size;
  }

  // Single-image reference (I2V).  For Seedance this is also accepted at
  // the top level as a shortcut when `extra_body.content` is absent.
  if (imageUrl) {
    body['input_reference'] = imageUrl;
  }

  // Seed & watermark: forward for non-Seedance models.
  // Seedance receives these inside `extra_body` (see below).
  if (!isSeedance(model)) {
    if (seed !== undefined && seed !== null) body['seed'] = seed;
    if (watermark !== undefined) body['watermark'] = watermark;
  }

  // ---- Seedance-specific `extra_body` ----
  if (isSeedance(model)) {
    const extra = buildSeedanceExtraBody(params);
    if (extra) body['extra_body'] = extra;

    // Seedance also accepts top-level watermark / duration when not inside
    // extra_body, but since we already build extra_body we keep them there.
    // If the user only sets watermark (no extra_body), fall back to top-level.
    if (!extra && watermark !== undefined) {
      body['watermark'] = watermark;
    }
  }

  // ---- Multi-image reference (R2V) for non-Seedance models ----
  // Models like Wan R2V / HappyHorse R2V need multi-image input.
  // AiHubMix does not document a top-level array field for this, but the
  // `/v1/videos` endpoint is OpenAI-compatible.  We forward `imageUrls` via
  // `extra_body.content` (same Seedance format) as a best-effort — AiHubMix
  // may map this to the correct upstream parameter.
  if (!isSeedance(model) && imageUrls && imageUrls.length > 0) {
    const content = imageUrls.map(
      (url: string): ContentRef => ({
        image_url: { url },
        role: 'reference_image',
        type: 'image_url',
      }),
    );
    body['extra_body'] = {
      ...(typeof body['extra_body'] === 'object' && body['extra_body'] !== null
        ? body['extra_body']
        : {}),
      content,
    };
  }

  log('AiHubMix video API request body: %O', body);

  const response = await fetch(`${baseURL}/videos`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('AiHubMix video API error: %s %s', response.status, errorText);
    throw new Error(`AiHubMix video API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  log('AiHubMix video API response: %O', data);

  if (!data?.id) {
    throw new Error('Invalid response: missing id');
  }

  return { inferenceId: data.id };
}
