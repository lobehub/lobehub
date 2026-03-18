import type { GenerateVideosConfig, GoogleGenAI } from '@google/genai';
import { GenerateVideosOperation } from '@google/genai';
import debug from 'debug';

import type { CreateVideoPayload, CreateVideoResponse } from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';
import { parseGoogleErrorMessage } from '../../utils/googleErrorParser';

const log = debug('model-runtime:google:video');

export async function createGoogleVideo(
  client: GoogleGenAI,
  provider: string,
  payload: CreateVideoPayload,
): Promise<CreateVideoResponse> {
  try {
    const { model, params } = payload;
    const { prompt, imageUrl, endImageUrl, aspectRatio, duration, resolution } = params;

    log('Creating video with Google AI - model: %s, params: %O', model, params);

    const config: GenerateVideosConfig = {
      ...(aspectRatio && { aspect_ratio: aspectRatio }),
      ...(duration && { duration_seconds: duration }),
      ...(endImageUrl && { last_frame: endImageUrl }),
      ...(resolution && { resolution }),
    };

    const requestParams: any = {
      config,
      model,
      prompt,
      ...(imageUrl && { image: imageUrl }),
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
