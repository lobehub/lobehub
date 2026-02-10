import { isEqual } from 'es-toolkit/compat';
import { useRef } from 'react';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { type GetGenerationStatusResult } from '@/server/routers/lambda/generation';
import { generationService } from '@/services/generation';
import { generationBatchService } from '@/services/generationBatch';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type GenerationBatch } from '@/types/generation';
import { setNamespace } from '@/utils/storeDebug';

import { type ImageStore } from '../../store';
import { generationTopicSelectors } from '../generationTopic/selectors';
import { type GenerationBatchDispatch, generationBatchReducer } from './reducer';

const n = setNamespace('generationBatch');

// ====== SWR key ====== //
const SWR_USE_FETCH_GENERATION_BATCHES = 'SWR_USE_FETCH_GENERATION_BATCHES';
const SWR_USE_CHECK_GENERATION_STATUS = 'SWR_USE_CHECK_GENERATION_STATUS';

// ====== action interface ====== //

export interface GenerationBatchAction {
  setTopicBatchLoaded: (topicId: string) => void;
  internal_dispatchGenerationBatch: (
    topicId: string,
    payload: GenerationBatchDispatch,
    action?: string,
  ) => void;
  removeGeneration: (generationId: string) => Promise<void>;
  internal_deleteGeneration: (generationId: string) => Promise<void>;
  removeGenerationBatch: (batchId: string, topicId: string) => Promise<void>;
  internal_deleteGenerationBatch: (batchId: string, topicId: string) => Promise<void>;
  refreshGenerationBatches: () => Promise<void>;
  useCheckGenerationStatus: (
    generationId: string,
    asyncTaskId: string,
    topicId: string,
    enable?: boolean,
  ) => SWRResponse<GetGenerationStatusResult>;
  useFetchGenerationBatches: (topicId?: string | null) => SWRResponse<GenerationBatch[]>;
}

// ====== action implementation ====== //

export const createGenerationBatchSlice: StateCreator<
  ImageStore,
  [['zustand/devtools', never]],
  [],
  GenerationBatchAction
> = (set, get) => ({
  setTopicBatchLoaded: (topicId: string) => {
    const nextMap = {
      ...get().generationBatchesMap,
      [topicId]: [],
    };

    // no need to update map if the map is the same
    if (isEqual(nextMap, get().generationBatchesMap)) return;

    set(
      {
        generationBatchesMap: nextMap,
      },
      false,
      n('setTopicBatchLoaded'),
    );
  },

  removeGeneration: async (generationId: string) => {
    const { internal_deleteGeneration, activeGenerationTopicId, refreshGenerationBatches } = get();

    await internal_deleteGeneration(generationId);

    // Check if any batch becomes empty after deletion, and if so, delete the empty batch
    if (activeGenerationTopicId) {
      const updatedBatches = get().generationBatchesMap[activeGenerationTopicId] || [];
      const emptyBatches = updatedBatches.filter((batch) => batch.generations.length === 0);

      // Delete all empty batches
      for (const emptyBatch of emptyBatches) {
        await get().internal_deleteGenerationBatch(emptyBatch.id, activeGenerationTopicId);
      }

      // If empty batches were deleted, refresh data again to ensure consistency
      if (emptyBatches.length > 0) {
        await refreshGenerationBatches();
      }
    }
  },

  internal_deleteGeneration: async (generationId: string) => {
    const { activeGenerationTopicId, refreshGenerationBatches, internal_dispatchGenerationBatch } =
      get();

    if (!activeGenerationTopicId) return;

    // Find the batch containing this generation
    const currentBatches = get().generationBatchesMap[activeGenerationTopicId] || [];
    const targetBatch = currentBatches.find((batch) =>
      batch.generations.some((gen) => gen.id === generationId),
    );

    if (!targetBatch) return;

    // 1. Immediately update frontend state (optimistic update)
    internal_dispatchGenerationBatch(
      activeGenerationTopicId,
      { type: 'deleteGenerationInBatch', batchId: targetBatch.id, generationId },
      'internal_deleteGeneration',
    );

    // 2. Call backend service to delete generation
    await generationService.deleteGeneration(generationId);

    // 3. Refresh data to ensure consistency
    await refreshGenerationBatches();
  },

  removeGenerationBatch: async (batchId: string, topicId: string) => {
    const { internal_deleteGenerationBatch } = get();
    await internal_deleteGenerationBatch(batchId, topicId);
  },

  internal_deleteGenerationBatch: async (batchId: string, topicId: string) => {
    const { internal_dispatchGenerationBatch, refreshGenerationBatches } = get();

    // 1. Immediately update frontend state (optimistic update)
    internal_dispatchGenerationBatch(
      topicId,
      { type: 'deleteBatch', id: batchId },
      'internal_deleteGenerationBatch',
    );

    // 2. Call backend service
    await generationBatchService.deleteGenerationBatch(batchId);

    // 3. Refresh data to ensure consistency
    await refreshGenerationBatches();
  },

  internal_dispatchGenerationBatch: (topicId, payload, action) => {
    const currentBatches = get().generationBatchesMap[topicId] || [];
    const nextBatches = generationBatchReducer(currentBatches, payload);

    const nextMap = {
      ...get().generationBatchesMap,
      [topicId]: nextBatches,
    };

    // no need to update map if the map is the same
    if (isEqual(nextMap, get().generationBatchesMap)) return;

    set(
      {
        generationBatchesMap: nextMap,
      },
      false,
      action ?? n(`dispatchGenerationBatch/${payload.type}`),
    );
  },

  refreshGenerationBatches: async () => {
    const { activeGenerationTopicId } = get();
    if (activeGenerationTopicId) {
      await mutate([SWR_USE_FETCH_GENERATION_BATCHES, activeGenerationTopicId]);
    }
  },

  useFetchGenerationBatches: (topicId) =>
    useClientDataSWR<GenerationBatch[]>(
      topicId ? [SWR_USE_FETCH_GENERATION_BATCHES, topicId] : null,
      async ([, topicId]: [string, string]) => {
        return generationBatchService.getGenerationBatches(topicId);
      },
      {
        onSuccess: (data) => {
          const nextMap = {
            ...get().generationBatchesMap,
            [topicId!]: data,
          };

          // no need to update map if the map is the same
          if (isEqual(nextMap, get().generationBatchesMap)) return;

          set(
            {
              generationBatchesMap: nextMap,
            },
            false,
            n('useFetchGenerationBatches(success)', { topicId }),
          );
        },
      },
    ),

  useCheckGenerationStatus: (generationId, asyncTaskId, topicId, enable = true) => {
    const requestCountRef = useRef(0);
    const isErrorRef = useRef(false);

    return useClientDataSWR<GetGenerationStatusResult>(
      enable && generationId && !generationId.startsWith('temp-') && asyncTaskId
        ? [SWR_USE_CHECK_GENERATION_STATUS, generationId, asyncTaskId]
        : null,
      async ([, generationId, asyncTaskId]: [string, string, string]) => {
        // Increment request count
        requestCountRef.current += 1;
        return generationService.getGenerationStatus(generationId, asyncTaskId);
      },
      {
        refreshWhenHidden: false,
        refreshInterval: (data: GetGenerationStatusResult | undefined) => {
          // If status is success or error, stop polling
          if (data?.status === AsyncTaskStatus.Success || data?.status === AsyncTaskStatus.Error) {
            return 0; // Stop polling
          }

          // Dynamically adjust interval based on request count: use exponential backoff algorithm
          // Base interval 1 second, max interval 30 seconds
          const baseInterval = 1000;
          const maxInterval = 30_000;
          const currentCount = requestCountRef.current;

          // Exponential backoff: double the interval every 5 requests
          const backoffMultiplier = Math.floor(currentCount / 5);
          let dynamicInterval = Math.min(
            baseInterval * Math.pow(2, backoffMultiplier),
            maxInterval,
          );

          // If there was a previous error, use a longer interval (multiply by 2)
          if (isErrorRef.current) {
            dynamicInterval = Math.min(dynamicInterval * 2, maxInterval);
          }

          return dynamicInterval;
        },
        onError: (error) => {
          // Set error state when an error occurs
          isErrorRef.current = true;
          console.error('Generation status check error:', error);
        },
        onSuccess: async (data: GetGenerationStatusResult) => {
          if (!data) return;

          // Reset error state on success
          isErrorRef.current = false;

          // Find the corresponding batch, generation database record contains generationBatchId
          const currentBatches = get().generationBatchesMap[topicId] || [];
          const targetBatch = currentBatches.find((batch) =>
            batch.generations.some((gen) => gen.id === generationId),
          );

          // If status is success or error, update the corresponding generation
          if (
            (data.status === AsyncTaskStatus.Success || data.status === AsyncTaskStatus.Error) &&
            targetBatch
          ) {
            // Reset request counter because the task is complete
            requestCountRef.current = 0;

            if (data.generation) {
              // Update generation data
              get().internal_dispatchGenerationBatch(
                topicId,
                {
                  type: 'updateGenerationInBatch',
                  batchId: targetBatch.id,
                  generationId,
                  value: data.generation,
                },
                n(
                  `useCheckGenerationStatus/${data.status === AsyncTaskStatus.Success ? 'success' : 'error'}`,
                ),
              );

              // If generation succeeds and has a thumbnail, check if the current topic has an imageUrl
              if (data.status === AsyncTaskStatus.Success && data.generation.asset?.thumbnailUrl) {
                const currentTopic =
                  generationTopicSelectors.getGenerationTopicById(topicId)(get());

                // If the current topic doesn't have an imageUrl, update it with this generation's thumbnailUrl
                if (currentTopic && !currentTopic.coverUrl) {
                  await get().updateGenerationTopicCover(
                    topicId,
                    data.generation.asset.thumbnailUrl,
                  );
                }
              }
            }

            // Refresh generation batches after success or failure
            await get().refreshGenerationBatches();
          }
        },
      },
    );
  },
});
