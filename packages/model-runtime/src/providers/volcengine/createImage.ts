import createDebug from 'debug';
import type { RuntimeImageGenParamsValue } from 'model-bank';
import OpenAI from 'openai';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';

const log = createDebug('lobe-image:volcengine');

/**
 * Volcengine image generation implementation
 * Based on Volcengine API docs: https://www.volcengine.com/docs/82379/1541523
 */
export async function createVolcengineImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { model, params } = payload;

  log('Creating image with Volcengine API - model: %s, params: %O', model, params);

  // Create OpenAI client with Volcengine configuration
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL || 'https://ark.cn-beijing.volces.com/api/v3',
  });

  // Parameter mapping: imageUrls/imageUrl -> image, cfg -> guidance_scale
  const paramsMap = new Map<RuntimeImageGenParamsValue, string>([
    ['imageUrls', 'image'],
    ['imageUrl', 'image'],
    ['cfg', 'guidance_scale'],
  ]);

  const userInput: Record<string, any> = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      paramsMap.get(key as RuntimeImageGenParamsValue) ?? key,
      value,
    ]),
  );

  // Volcengine supports direct URL or base64, no need to convert to File objects
  // Check if there is image input
  const hasImageInput =
    userInput.image !== null &&
    userInput.image !== undefined &&
    (Array.isArray(userInput.image) ? userInput.image.length > 0 : true);

  if (hasImageInput) {
    log('Image input detected: %O', userInput.image);
  } else {
    delete userInput.image;
  }

  // Build request options
  const requestOptions = {
    model,
    watermark: false, // Default to no watermark
    ...userInput,
  };

  log('Volcengine API options: %O', requestOptions);

  // Call Volcengine image generation API
  const response = await client.images.generate(requestOptions as any);

  log('Volcengine API response: %O', response);

  // Validate response data
  if (!response || !response.data || !Array.isArray(response.data) || response.data.length === 0) {
    log('Invalid response: missing data array');
    throw new Error('Invalid response: missing or empty data array');
  }

  const imageData = response.data[0];
  if (!imageData) {
    log('Invalid response: first data item is null/undefined');
    throw new Error('Invalid response: first data item is null or undefined');
  }

  let imageUrl: string;
  let width: number | undefined;
  let height: number | undefined;

  // Handle base64 format response
  if (imageData.b64_json) {
    const mimeType = 'image/jpeg'; // Volcengine defaults to JPEG format
    imageUrl = `data:${mimeType};base64,${imageData.b64_json}`;
    log('Successfully converted base64 to data URL, length: %d', imageUrl.length);
  }
  // Handle URL format response
  else if (imageData.url) {
    imageUrl = imageData.url;
    log('Using direct image URL: %s', imageUrl);
  }
  // If neither format exists, throw error
  else {
    log('Invalid response: missing both b64_json and url fields');
    throw new Error('Invalid response: missing both b64_json and url fields');
  }

  // Extract size information (Volcengine specific)
  const volcengineImageData = imageData as any;
  if (volcengineImageData.size) {
    const sizeMatch = volcengineImageData.size.match(/^(\d+)x(\d+)$/);
    if (sizeMatch) {
      width = parseInt(sizeMatch[1], 10);
      height = parseInt(sizeMatch[2], 10);
      log('Extracted image dimensions: %dx%d', width, height);
    }
  }

  return {
    height,
    imageUrl,
    width,
  };
}
