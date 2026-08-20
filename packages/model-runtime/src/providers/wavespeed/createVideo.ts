import createDebug from 'debug';

import { AgentRuntimeErrorType } from '../../types/error';
import type {
  CreateVideoPayload,
  CreateVideoResponse,
  PollVideoStatusResult,
} from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';
import { queryTask, submitTask } from './api';
import { buildRequestBody } from './params';
import type { WaveSpeedCreateOptions } from './types';
import { isWaveSpeedFailure } from './types';

const log = createDebug('lobe-video:wavespeed');

const INFERENCE_ID_SEPARATOR = '::';

/**
 * The poll endpoint is model-agnostic, but keeping the model in the inference
 * id makes the stored task self-describing and matches how other providers
 * (e.g. MiniMax) encode theirs.
 */
const buildInferenceId = (model: string, predictionId: string) =>
  `${model}${INFERENCE_ID_SEPARATOR}${predictionId}`;

export const parseInferenceId = (inferenceId: string) => {
  const index = inferenceId.indexOf(INFERENCE_ID_SEPARATOR);

  if (index === -1) return { id: inferenceId, model: undefined };

  return {
    id: inferenceId.slice(index + INFERENCE_ID_SEPARATOR.length),
    model: inferenceId.slice(0, index),
  };
};

/**
 * Submit a video prediction. Video generation is long-running, so this only
 * creates the task; LobeHub drives `pollWaveSpeedVideoStatus` afterwards.
 */
export const createWaveSpeedVideo = async (
  payload: CreateVideoPayload,
  options: WaveSpeedCreateOptions,
): Promise<CreateVideoResponse> => {
  const { model, params } = payload;

  try {
    const body = buildRequestBody(params);

    // Submitted exactly once — a retry here would create a second paid task.
    const predictionId = await submitTask(model, body, options);

    return { inferenceId: buildInferenceId(model, predictionId) };
  } catch (error) {
    log('Error in createWaveSpeedVideo: %O', error);

    if (error instanceof Error && 'status' in error && (error as any).status === 401) {
      throw AgentRuntimeError.createVideo({
        error: error as any,
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        provider: options.provider,
      });
    }

    throw AgentRuntimeError.createVideo({
      error: error as any,
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: options.provider,
    });
  }
};

export const pollWaveSpeedVideoStatus = async (
  inferenceId: string,
  options: WaveSpeedCreateOptions,
): Promise<PollVideoStatusResult> => {
  const { id } = parseInferenceId(inferenceId);

  const response = await queryTask(id, options);
  const { status, outputs, error } = response.data;

  log('Prediction %s status: %s', id, status);

  if (status === 'completed') {
    const videoUrl = outputs?.[0];

    if (!videoUrl) {
      return { error: 'WaveSpeed prediction completed but returned no video', status: 'failed' };
    }

    return { status: 'success', videoUrl };
  }

  if (isWaveSpeedFailure(status)) {
    return {
      error: `WaveSpeed prediction ${status}${error ? `: ${error}` : ''} (prediction id: ${id})`,
      status: 'failed',
    };
  }

  return { status: 'pending' };
};
