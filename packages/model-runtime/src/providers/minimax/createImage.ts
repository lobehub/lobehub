import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-image:minimax');

interface MiniMaxImageResponse {
  base_resp: {
    status_code: number;
    status_msg: string;
  };
  data: {
    image_urls: string[];
  };
  id: string;
  metadata: {
    failed_count: string;
    success_count: string;
  };
}

/**
 * Create image using MiniMax API
 */
export async function createMiniMaxImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { apiKey, baseURL, provider } = options;
  const { model, params } = payload;

  try {
    const endpoint = `${baseURL}/image_generation`;

    const response = await fetch(endpoint, {
      body: JSON.stringify({
        aspect_ratio: params.aspectRatio,
        model,
        n: 1,
        prompt: params.prompt,
        //prompt_optimizer: true, // 开启 prompt 自动优化
        ...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
      }),
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
        `MiniMax API error (${response.status}): ${errorData?.base_resp || response.statusText}`,
      );
    }

    const data: MiniMaxImageResponse = await response.json();

    log('Image generation response: %O', data);

    // Check API response status
    if (data.base_resp.status_code !== 0) {
      throw new Error(`MiniMax API error: ${data.base_resp.status_msg}`);
    }

    // Check if we have valid image data
    if (!data.data?.image_urls || data.data.image_urls.length === 0) {
      throw new Error('No images generated in response');
    }

    // Log generation statistics
    const successCount = parseInt(data.metadata.success_count);
    const failedCount = parseInt(data.metadata.failed_count);
    log('Image generation completed: %d successful, %d failed', successCount, failedCount);

    // Return the first generated image URL
    const imageUrl = data.data.image_urls[0];

    if (!imageUrl) {
      throw new Error('No valid image URL in response');
    }

    log('Image generated successfully: %s', imageUrl);

    return { imageUrl };
  } catch (error) {
    log('Error in createMiniMaxImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
