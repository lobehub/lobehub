import { isRecord, isTrimmedNonEmptyString } from '@lobechat/utils/object';
import OpenAI from 'openai';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleImage } from '../../core/openaiCompatibleFactory/createImage';
import { convertOpenAIUsage } from '../../core/usageConverters/openai';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { resolveMappedModelId } from '../../utils/modelIdMapping';

interface OpenRouterImageRequest {
  aspect_ratio?: string;
  input_references?: Array<{ image_url: { url: string }; type: 'image_url' }>;
  model: string;
  prompt: string;
  quality?: string;
  resolution?: string;
  seed?: number;
  size?: string;
}

type OpenRouterImageUsage = OpenAI.Completions.CompletionUsage & {
  cost?: number | null;
  prompt_tokens_details?: OpenAI.Completions.CompletionUsage['prompt_tokens_details'] & {
    image_tokens?: number | null;
  };
};

const isOpenRouterImageUsage = (value: unknown): value is OpenRouterImageUsage =>
  isRecord(value) &&
  typeof value.prompt_tokens === 'number' &&
  typeof value.completion_tokens === 'number' &&
  typeof value.total_tokens === 'number';

export async function createOpenRouterImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { provider, modelIdMapping: _modelIdMapping, ...clientOptions } = options;
  const { params } = payload;

  try {
    const client = new OpenAI({
      ...clientOptions,
      baseURL: options.baseURL || 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://lobehub.com',
        'X-Title': 'LobeHub',
        ...options.defaultHeaders,
      },
    });
    if (payload.model.endsWith(':image')) {
      return await createOpenAICompatibleImage(client, payload, provider, {
        requestModel: resolveMappedModelId(payload.model, options),
        routingModel: payload.model,
      });
    }

    const body: OpenRouterImageRequest = {
      model: resolveMappedModelId(payload.model, options),
      prompt: params.prompt,
    };

    const size =
      params.size && params.size !== 'auto'
        ? params.size
        : params.width && params.height
          ? `${params.width}x${params.height}`
          : undefined;

    if (size) body.size = size;

    // Explicit pixels are authoritative; combining them with a ratio or resolution can cause a 400.
    const hasExplicitDimensions = size !== undefined && /^\d+x\d+$/.test(size);
    if (!hasExplicitDimensions && params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    // A tier size already supplies resolution. Unlike the chat API, this endpoint accepts "512".
    if (!size && params.resolution) body.resolution = params.resolution;
    if (typeof params.seed === 'number') body.seed = params.seed;
    if (params.quality) body.quality = params.quality;

    const imageUrls = params.imageUrls?.length
      ? params.imageUrls
      : params.imageUrl
        ? [params.imageUrl]
        : undefined;
    if (imageUrls) {
      body.input_references = imageUrls.map((url) => ({ image_url: { url }, type: 'image_url' }));
    }

    // Use the dedicated endpoint for native image-model IDs.
    const data = await client.post<unknown>('/images', { body });

    if (isRecord(data) && isRecord(data.error)) throw data.error;
    if (!isRecord(data) || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('Invalid OpenRouter image response: missing or empty data array');
    }

    const image = data.data[0];
    if (!isRecord(image) || !isTrimmedNonEmptyString(image.b64_json)) {
      throw new Error('Invalid OpenRouter image response: missing base64 image');
    }

    const mediaType = image.media_type ?? 'image/png';
    if (typeof mediaType !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(mediaType)) {
      throw new Error('Invalid OpenRouter image response: invalid image media type');
    }

    const result: CreateImageResponse = {
      imageUrl: `data:${mediaType};base64,${image.b64_json}`,
    };

    if (isOpenRouterImageUsage(data.usage)) {
      const usage = data.usage;
      result.modelUsage = convertOpenAIUsage(usage);
      const inputImageTokens = usage.prompt_tokens_details?.image_tokens;
      if (typeof inputImageTokens === 'number') {
        result.modelUsage.inputImageTokens = inputImageTokens;
        result.modelUsage.inputTextTokens = Math.max(
          0,
          (result.modelUsage.inputTextTokens ?? 0) - inputImageTokens,
        );
      }
      if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) {
        result.modelUsage.cost = usage.cost;
      }
    }

    return result;
  } catch (error) {
    throw AgentRuntimeError.createImage({
      error: isRecord(error) ? error : new Error(String(error)),
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
