import type { GenerateVideosConfig, GoogleGenAI, Image } from '@google/genai';
import { GenerateVideosOperation } from '@google/genai';
import { imageUrlToBase64 } from '@lobechat/utils';
import debug from 'debug';

import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';
import { parseGoogleErrorMessage } from '../../utils/googleErrorParser';
import { parseDataUri } from '../../utils/uriParser';

const log = debug('lobe-video:google');

/**
 * Convert image URL to Google Image format
 * Supports: data URI, HTTP URL, and file paths
 */
async function imageToGoogleImageFormat(imageUrl: string): Promise<Image> {
  const { mimeType, base64, type } = parseDataUri(imageUrl);

  if (type === 'base64') {
    if (!base64) {
      throw new TypeError("Image URL doesn't contain base64 data");
    }

    return {
      imageBytes: base64,
      mimeType: mimeType || 'image/png',
    };
  } else if (type === 'url') {
    // Handle both HTTP URLs and file paths (files/...)
    const { base64: urlBase64, mimeType: urlMimeType } = await imageUrlToBase64(imageUrl);

    return {
      imageBytes: urlBase64,
      mimeType: urlMimeType,
    };
  } else {
    throw new TypeError(`currently we don't support image url: ${imageUrl}`);
  }
}

export async function createGoogleVideo(
  client: GoogleGenAI,
  provider: string,
  payload: CreateVideoPayload,
): Promise<CreateVideoResponse> {
  try {
    const { model, params } = payload;
    const {
      prompt,
      imageUrl,
      endImageUrl,
      aspectRatio,
      duration,
      resolution,
      seed,
      generateAudio, // generateAudio parameter is not supported in Gemini API.
    } = params;

    log('Creating video with Google AI - model: %s, params: %O', model, params);

    // https://github.com/googleapis/js-genai/blob/main/src/types.ts
    const config: GenerateVideosConfig = {
      ...(aspectRatio && { aspectRatio }),
      ...(duration && { durationSeconds: duration }),
      ...(endImageUrl && { lastFrame: await imageToGoogleImageFormat(endImageUrl) }),
      ...(generateAudio && { generateAudio }),
      ...(resolution && { resolution }),
      ...(seed !== undefined && seed !== null && { seed }),
    };

    const requestParams: any = {
      model,
      prompt,
      ...(imageUrl && { image: await imageToGoogleImageFormat(imageUrl) }),
      ...(config && { config }),
    };

    log('Google video generation request params: %O', requestParams);

    const operation = await client.models.generateVideos(requestParams);

    log('Video generation started, operation name: %s', operation.name);

    return { inferenceId: operation.name || '' };
  } catch (error) {
    const err = error as Error;
    log('Error creating video with Google AI: %O', err);

    if ((err as any)?.errorType) {
      throw err;
    }

    const { errorType, error: parsedError } = parseGoogleErrorMessage(err.message);
    throw AgentRuntimeError.createVideo({
      error: parsedError,
      errorType,
      provider,
    });
  }
}

export async function pollGoogleVideoOperation(
  client: GoogleGenAI,
  inferenceId: string,
  provider: string,
  apiKey: string,
): Promise<
  | { headers?: Record<string, string>; status: 'success'; videoUrl: string }
  | { status: 'failed'; error: string }
  | { status: 'pending' }
> {
  try {
    log('Polling video operation status: %s', inferenceId);

    if (!inferenceId) {
      return { error: 'Invalid operation name', status: 'failed' };
    }

    // Create a proper GenerateVideosOperation instance from the operation name
    const operation = new GenerateVideosOperation();
    operation.name = inferenceId;

    const updatedOperation = await client.operations.getVideosOperation({
      operation,
    });

    log('Video operation status: %O', updatedOperation);

    if (updatedOperation.done) {
      if (updatedOperation.error) {
        const errorMessage = (updatedOperation.error as any)?.message || 'Video generation failed';
        return {
          error: errorMessage,
          status: 'failed',
        };
      }

      if (!updatedOperation.response?.generatedVideos?.[0]?.video) {
        if (updatedOperation?.response?.raiMediaFilteredReasons) {
          return {
            error: updatedOperation.response.raiMediaFilteredReasons[0],
            status: 'failed',
          };
        }

        return {
          error: 'No video generated',
          status: 'failed',
        };
      }

      const video = updatedOperation.response.generatedVideos[0].video;
      const videoUrl = video.uri;

      if (!videoUrl) {
        return {
          error: 'Video URL is empty',
          status: 'failed',
        };
      }

      log('Video generation completed, download URI: %s', videoUrl);

      // Return headers for authenticated download
      // Google uses x-goog-api-key header
      return {
        headers: {
          'x-goog-api-key': apiKey,
        },
        status: 'success',
        videoUrl,
      };
    }

    log('Video generation still in progress');
    return { status: 'pending' };
  } catch (error) {
    const err = error as Error;
    log('Error polling video operation: %O', err);

    return {
      error: err.message || 'Failed to poll video status',
      status: 'failed',
    };
  }
}
