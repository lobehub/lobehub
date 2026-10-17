import type { ModelUsage } from '@lobechat/types';
import { imageUrlToBase64, parseDataUri } from '@lobechat/utils';
import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { resolveMappedModelId } from '../../utils/modelIdMapping';

const log = createDebug('lobe-image:openrouter');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter dedicated image generation API request.
 * @see https://openrouter.ai/docs/api-reference/images
 */
interface OpenRouterImageRequest {
  aspect_ratio?: string;
  input_references?: Array<{
    image_url: { url: string };
    type: 'image_url';
  }>;
  model: string;
  prompt: string;
  quality?: string;
  resolution?: string;
  seed?: number;
  size?: string;
}

interface OpenRouterImageResponse {
  created: number;
  data: Array<{
    b64_json: string;
    media_type?: string;
  }>;
  usage?: {
    completion_tokens?: number;
    cost?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Sniff the image MIME type from the magic bytes of a base64 payload.
 * OpenRouter may omit `media_type` for raster outputs, which are not always PNG.
 */
const sniffImageMimeType = (b64: string): string => {
  const head = atob(b64.slice(0, 24));
  const bytes = Uint8Array.from(head, (c) => c.codePointAt(0)!);

  if (bytes[0] === 0x89 && head.slice(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  if (head.startsWith('GIF8')) return 'image/gif';
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml';

  return 'image/png';
};

/**
 * Inline a reference image so OpenRouter never has to reach back into the
 * deployment. Lobe uploads are forwarded as `${APP_URL}/f/:id` proxy URLs,
 * which are unreachable from OpenRouter on self-hosted/private deployments;
 * convert those to base64 data URLs before sending. Data URLs pass through
 * untouched.
 */
const inlineReferenceUrl = async (url: string): Promise<string> => {
  if (parseDataUri(url).type === 'base64') return url;

  const { base64, mimeType } = await imageUrlToBase64(url);
  return `data:${mimeType};base64,${base64}`;
};

const buildRequestBody = async (
  model: string,
  params: CreateImagePayload['params'],
): Promise<OpenRouterImageRequest> => {
  const body: OpenRouterImageRequest = {
    model,
    prompt: params.prompt,
  };

  // 'auto' means use the model default — omit the parameter
  if (params.aspectRatio && params.aspectRatio !== 'auto') body.aspect_ratio = params.aspectRatio;
  if (params.resolution) body.resolution = params.resolution;
  if (params.quality && params.quality !== 'auto') body.quality = params.quality;
  if (params.size && params.size !== 'auto') body.size = params.size;
  if (typeof params.seed === 'number') body.seed = params.seed;

  const referenceUrls = [
    ...(params.imageUrl ? [params.imageUrl] : []),
    ...(params.imageUrls ?? []),
  ].filter(Boolean);

  if (referenceUrls.length > 0) {
    const inlinedUrls = await Promise.all(referenceUrls.map(inlineReferenceUrl));
    body.input_references = inlinedUrls.map((url) => ({
      image_url: { url },
      type: 'image_url' as const,
    }));
  }

  return body;
};

/**
 * Create image using OpenRouter's dedicated image generation API
 * (`POST /api/v1/images`), instead of routing image models through
 * chat completions.
 */
export async function createOpenRouterImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { apiKey, baseURL, provider } = options;
  const { model, params } = payload;
  const requestModel = resolveMappedModelId(model, {
    modelIdMapping: options.modelIdMapping,
  }).replace(/:image$/, '');

  try {
    const endpoint = `${(baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '')}/images`;
    const requestBody = await buildRequestBody(requestModel, params);

    log('Calling OpenRouter image API: %s with model: %s', endpoint, requestModel);

    const response = await fetch(endpoint, {
      body: JSON.stringify(requestBody),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://lobehub.com',
        'X-Title': 'LobeHub',
      },
      method: 'POST',
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        // Failed to parse JSON error response
      }

      throw new Error(
        `OpenRouter image API error (${response.status}): ${
          errorData?.error?.message || response.statusText
        }`,
      );
    }

    const data: OpenRouterImageResponse = await response.json();

    const image = data.data?.[0];
    if (!image?.b64_json) {
      throw new Error('Invalid image response: missing b64_json data');
    }

    const mimeType = image.media_type || sniffImageMimeType(image.b64_json);
    const imageUrl = `data:${mimeType};base64,${image.b64_json}`;

    log('Image generated successfully, mime: %s, usage: %O', mimeType, data.usage);

    let modelUsage: ModelUsage | undefined;
    if (data.usage) {
      modelUsage = {
        cost: data.usage.cost,
        totalInputTokens: data.usage.prompt_tokens,
        totalOutputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      };
    }

    return {
      imageUrl,
      ...(modelUsage ? { modelUsage } : {}),
    };
  } catch (error) {
    log('Error in createOpenRouterImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
