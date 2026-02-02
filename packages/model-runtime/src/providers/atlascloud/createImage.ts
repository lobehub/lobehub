import createDebug from 'debug';

import { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import { AgentRuntimeErrorType } from '../../types/error';
import { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { type TaskResult, asyncifyPolling } from '../../utils/asyncifyPolling';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-image:atlascloud');

interface AtlasCloudGenerateResponse {
  data: {
    id: string;
  };
}

interface AtlasCloudPredictionResponse {
  data: {
    error?: string;
    output?: string | string[];
    outputs?: string[];
    status: string;
  };
}

/**
 * Submit image generation task to AtlasCloud API
 */
async function submitImageTask(
  payload: Record<string, unknown>,
  options: CreateImageOptions,
): Promise<string> {
  // AtlasCloud image API lives at /api/v1/model/generateImage on the base domain
  // The baseURL for chat is https://api.atlascloud.ai/v1, so strip /v1
  const baseUrl = (options.baseURL || 'https://api.atlascloud.ai/v1').replace(/\/v1\/?$/, '');
  const url = `${baseUrl}/api/v1/model/generateImage`;

  log('Submitting image generation to: %s', url);

  const response = await fetch(url, {
    body: JSON.stringify(payload),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
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
      `AtlasCloud API error (${response.status}): ${errorData?.message || errorData?.error || response.statusText}`,
    );
  }

  const data: AtlasCloudGenerateResponse = await response.json();

  if (!data?.data?.id) {
    throw new Error(`Unexpected generateImage response: ${JSON.stringify(data)}`);
  }

  log('Image task submitted with prediction ID: %s', data.data.id);
  return data.data.id;
}

/**
 * Poll prediction status from AtlasCloud API
 */
async function queryPrediction(
  predictionId: string,
  options: CreateImageOptions,
): Promise<AtlasCloudPredictionResponse> {
  const baseUrl = (options.baseURL || 'https://api.atlascloud.ai/v1').replace(/\/v1\/?$/, '');
  const url = `${baseUrl}/api/v1/model/prediction/${predictionId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    method: 'GET',
  });

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      // Failed to parse JSON error response
    }

    throw new Error(
      `Failed to query prediction (${response.status}): ${errorData?.message || response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Create image using AtlasCloud API with async polling
 */
export async function createAtlasCloudImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { model, params } = payload;

  try {
    // Build the request payload for AtlasCloud
    // AtlasCloud uses "width*height" format for size
    const size =
      params.size ||
      (params.width && params.height ? `${params.width}*${params.height}` : undefined);

    const requestPayload: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      ...(size && { size }),
      ...(params.aspectRatio && { aspect_ratio: params.aspectRatio }),
      ...(params.resolution && { resolution: params.resolution }),
      ...(params.seed !== null && params.seed !== undefined && { seed: params.seed }),
    };

    // Submit the image generation task
    const predictionId = await submitImageTask(requestPayload, options);

    // Poll until completion using asyncifyPolling
    return await asyncifyPolling<AtlasCloudPredictionResponse, CreateImageResponse>({
      checkStatus: (result): TaskResult<CreateImageResponse> => {
        const status = result?.data?.status;
        log('Prediction %s status: %s', predictionId, status);

        if (status === 'completed' || status === 'succeeded') {
          // Response may use 'outputs' (array) or 'output' (string or array)
          const outputs = result.data.outputs;
          const output = result.data.output;
          const imageUrl = outputs?.[0] || (Array.isArray(output) ? output[0] : output);

          if (!imageUrl) {
            return {
              error: new Error('Image generation completed but no output URL returned'),
              status: 'failed',
            };
          }

          return {
            data: { imageUrl },
            status: 'success',
          };
        }

        if (status === 'failed') {
          return {
            error: new Error(result.data.error || 'Image generation failed'),
            status: 'failed',
          };
        }

        // Still processing
        return { status: 'pending' };
      },
      initialInterval: 2000,
      logger: {
        debug: (message: any, ...args: any[]) => log(message, ...args),
        error: (message: any, ...args: any[]) => log(message, ...args),
      },
      maxInterval: 10_000,
      pollingQuery: () => queryPrediction(predictionId, options),
    });
  } catch (error) {
    log('Error in createAtlasCloudImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: options.provider,
    });
  }
}
