import createDebug from 'debug';

import { AgentRuntimeErrorType } from '../../types/error';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { asyncifyPolling } from '../../utils/asyncifyPolling';
import { AgentRuntimeError } from '../../utils/createError';
import { queryTask, submitTask } from './api';
import { buildRequestBody } from './params';
import type { WaveSpeedCreateOptions, WaveSpeedPredictionResponse } from './types';
import { isWaveSpeedFailure } from './types';

const log = createDebug('lobe-image:wavespeed');

/**
 * WaveSpeed runs every model as an asynchronous prediction: one POST submits
 * the task, then the prediction is polled until it reaches a terminal status.
 */
export const createWaveSpeedImage = async (
  payload: CreateImagePayload,
  options: WaveSpeedCreateOptions,
): Promise<CreateImageResponse> => {
  const { model, params } = payload;

  try {
    const body = buildRequestBody(params);

    // Submitted exactly once — see the note on `submitTask`.
    const predictionId = await submitTask(model, body, options);

    return await asyncifyPolling<WaveSpeedPredictionResponse, CreateImageResponse>({
      checkStatus: (response): TaskResult<CreateImageResponse> => {
        const { status, outputs, error } = response.data;

        log('Prediction %s status: %s', predictionId, status);

        if (status === 'completed') {
          const imageUrl = outputs?.[0];

          if (!imageUrl) {
            return {
              error: new Error('WaveSpeed prediction completed but returned no image'),
              status: 'failed',
            };
          }

          return { data: { imageUrl }, status: 'success' };
        }

        if (isWaveSpeedFailure(status)) {
          return {
            error: new Error(
              `WaveSpeed prediction ${status}${error ? `: ${error}` : ''} (prediction id: ${predictionId})`,
            ),
            status: 'failed',
          };
        }

        // `created` / `processing` — keep waiting.
        return { status: 'pending' };
      },
      logger: {
        debug: (message: any, ...args: any[]) => log(message, ...args),
        error: (message: any, ...args: any[]) => log(message, ...args),
      },
      pollingQuery: () => queryTask(predictionId, options),
    });
  } catch (error) {
    log('Error in createWaveSpeedImage: %O', error);

    if (error instanceof Error && 'status' in error && (error as any).status === 401) {
      throw AgentRuntimeError.createImage({
        error: error as any,
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        provider: options.provider,
      });
    }

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: options.provider,
    });
  }
};
