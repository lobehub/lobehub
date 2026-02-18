import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-image:wenxin');

interface WenxinImageResponse {
  created: number;
  data: {
    url: string;
  }[];
  id: string;
}

/**
 * Create image using Wenxin API
 * Supports multiple models with different endpoints:
 * - musesteamer-air-image: /v2/musesteamer/images/generations
 * - Other models (with image): /v2/images/edits
 * - Other models (without image): /v2/images/generations
 */
export async function createWenxinImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { apiKey, baseURL, provider } = options;
  const { model, params } = payload;

  try {
    let endpoint: string;

    const images =
      params.imageUrls && params.imageUrls.length > 0 ? params.imageUrls : params.imageUrl;

    if (model.startsWith('musesteamer')) {
      endpoint = `${baseURL}/musesteamer/images/generations`;
    } else {
      if (images) {
        endpoint = `${baseURL}/images/edits`;
      } else {
        endpoint = `${baseURL}/images/generations`;
      }
    }

    const requestBody: Record<string, any> = {
      model,
      prompt: params.prompt,
      ...(images !== undefined && { image: images }),
      ...(params.seed !== undefined && { seed: params.seed }),
      ...(params.width !== undefined && params.height !== undefined
        ? { size: `${params.width}x${params.height}` }
        : params.size !== undefined
          ? { size: params.size }
          : {}),
      ...(params.steps !== undefined && { steps: params.steps }),
      ...(model === 'ernie-irag-edit' && { feature: 'variation' }),
    };

    const response = await fetch(endpoint, {
      body: JSON.stringify(requestBody),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {}

      const errorMessage =
        typeof errorData?.error === 'string'
          ? errorData.error
          : JSON.stringify(errorData?.error || errorData);

      throw new Error(
        `Wenxin API error (${response.status}): ${errorMessage || response.statusText}`,
      );
    }

    const data: WenxinImageResponse = await response.json();

    log('Image generation response: %O', data);

    if (!data.data || data.data.length === 0) {
      throw new Error('No images generated in response');
    }

    const resultImageUrl = data.data[0].url;

    if (!resultImageUrl) {
      throw new Error('No valid image URL in response');
    }

    log('Image generated successfully: %s', resultImageUrl);

    return { imageUrl: resultImageUrl };
  } catch (error) {
    log('Error in createWenxinImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
