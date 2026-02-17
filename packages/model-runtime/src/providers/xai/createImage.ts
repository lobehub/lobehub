import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-image:xai');

interface XAIImageResponse {
  data: Array<{
    url: string;
  }>;
}

/**
 * Create image using XAI (Grok) API
 */
export async function createXAIImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { apiKey, baseURL, provider } = options;
  const { model, params } = payload;

  try {
    const isImageEdit = params.imageUrl && params.imageUrl !== '';
    const endpoint = isImageEdit ? `${baseURL}/images/edits` : `${baseURL}/images/generations`;

    const requestBody: any = {
      model,
      prompt: params.prompt,
    };

    if (!isImageEdit && params.aspectRatio) {
      requestBody.aspect_ratio = params.aspectRatio;
    }

    if (params.resolution) {
      requestBody.resolution = params.resolution;
    }

    if (isImageEdit) {
      requestBody.image = {
        type: 'image_url',
        url: params.imageUrl,
      };
    }

    log('Calling XAI image API: %s with body: %O', endpoint, requestBody);

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
      } catch {
        // Failed to parse JSON error response
      }

      throw new Error(
        `XAI API error (${response.status}): ${errorData?.error?.message || response.statusText}`,
      );
    }

    const data: XAIImageResponse = await response.json();

    log('Image generation response: %O', data);

    if (!data.data || data.data.length === 0) {
      throw new Error('No images generated in response');
    }

    const imageUrl = data.data[0].url;

    if (!imageUrl) {
      throw new Error('No valid image URL in response');
    }

    log('Image generated successfully: %s', imageUrl);

    return { imageUrl };
  } catch (error) {
    log('Error in createXAIImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
