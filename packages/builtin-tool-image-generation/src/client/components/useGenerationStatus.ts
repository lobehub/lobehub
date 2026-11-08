'use client';

import { useCallback, useEffect, useState } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { imageKeys } from '@/libs/swr/keys';
import { generationService } from '@/services/generation';

import type {
  GeneratedImageTask,
  GetImageGenerationStatusParams,
  GetImageGenerationStatusState,
} from '../../types';

const POLLING_INTERVAL = 3000;

export const isTerminalStatus = (status?: string) => status === 'success' || status === 'error';

const assetUrl = (asset?: GeneratedImageTask['asset']) =>
  asset?.url || asset?.thumbnailUrl || asset?.originalUrl;

export const getStateAssetUrl = (state?: GetImageGenerationStatusState) =>
  assetUrl(state?.generation?.asset);

export const getTaskAssetUrl = (task: GeneratedImageTask) => assetUrl(task.asset);

const errorDetail = (error?: GeneratedImageTask['error']) => {
  if (!error) return;
  const body = error.body;
  if (typeof body === 'string') return body;
  return body.detail;
};

export const getStateErrorDetail = (state?: GetImageGenerationStatusState) =>
  errorDetail(state?.error);

export const getTaskErrorDetail = (task: GeneratedImageTask) => errorDetail(task.error);

/**
 * Polls one generation until it reaches a terminal status, so a card whose
 * stored result was still in flight keeps updating itself instead of animating
 * forever. Polling stops on the first error and resumes on an explicit retry.
 */
export const useGenerationStatus = (params: GetImageGenerationStatusParams, enabled: boolean) => {
  const [pollingStopped, setPollingStopped] = useState(false);

  useEffect(() => {
    setPollingStopped(false);
  }, [params.asyncTaskId, params.generationId]);

  const result = useClientDataSWR<GetImageGenerationStatusState>(
    enabled && params.asyncTaskId
      ? imageKeys.generationStatus(params.generationId, params.asyncTaskId)
      : null,
    async () => {
      const result = await generationService.getGenerationStatus(
        params.generationId,
        params.asyncTaskId,
      );
      return {
        ...result,
        asyncTaskId: params.asyncTaskId,
        generationId: params.generationId,
      };
    },
    {
      onError: () => setPollingStopped(true),
      onSuccess: () => setPollingStopped(false),
      refreshInterval: (data?: GetImageGenerationStatusState) =>
        pollingStopped || isTerminalStatus(data?.status) ? 0 : POLLING_INTERVAL,
      shouldRetryOnError: false,
    },
  );

  const { mutate } = result;
  const retry = useCallback(() => {
    setPollingStopped(false);
    void mutate();
  }, [mutate]);

  return { ...result, retry };
};
