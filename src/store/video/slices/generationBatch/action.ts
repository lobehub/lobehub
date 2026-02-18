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

import { type VideoStore } from '../../store';
import { generationTopicSelectors } from '../generationTopic/selectors';
import { type GenerationBatchDispatch, generationBatchReducer } from './reducer';

const n = setNamespace('generationBatch');

// ====== SWR key ====== //
const SWR_USE_FETCH_GENERATION_BATCHES = 'SWR_USE_FETCH_VIDEO_GENERATION_BATCHES';
const SWR_USE_CHECK_GENERATION_STATUS = 'SWR_USE_CHECK_VIDEO_GENERATION_STATUS';

// ====== action interface ====== //

export interface GenerationBatchAction {
  internal_deleteGeneration: (generationId: string) => Promise<void>;
  internal_deleteGenerationBatch: (batchId: string, topicId: string) => Promise<void>;
  internal_dispatchGenerationBatch: (
    topicId: string,
    payload: GenerationBatchDispatch,
    action?: string,
  ) => void;
  refreshGenerationBatches: () => Promise<void>;
  removeGeneration: (generationId: string) => Promise<void>;
  removeGenerationBatch: (batchId: string, topicId: string) => Promise<void>;
  setTopicBatchLoaded: (topicId: string) => void;
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
  VideoStore,
  [['zustand/devtools', never]],
  [],
  GenerationBatchAction
> = (set, get) => ({
  internal_deleteGeneration: async (generationId: string) => {
    const { activeGenerationTopicId, refreshGenerationBatches, internal_dispatchGenerationBatch } =
      get();

    if (!activeGenerationTopicId) return;

    const currentBatches = get().generationBatchesMap[activeGenerationTopicId] || [];
    const targetBatch = currentBatches.find((batch) =>
      batch.generations.some((gen) => gen.id === generationId),
    );

    if (!targetBatch) return;

    // Optimistic update
    internal_dispatchGenerationBatch(
      activeGenerationTopicId,
      { batchId: targetBatch.id, generationId, type: 'deleteGenerationInBatch' },
      'internal_deleteGeneration',
    );

    await generationService.deleteGeneration(generationId);
    await refreshGenerationBatches();
  },

  internal_deleteGenerationBatch: async (batchId: string, topicId: string) => {
    const { internal_dispatchGenerationBatch, refreshGenerationBatches } = get();

    // Optimistic update
    internal_dispatchGenerationBatch(
      topicId,
      { id: batchId, type: 'deleteBatch' },
      'internal_deleteGenerationBatch',
    );

    await generationBatchService.deleteGenerationBatch(batchId);
    await refreshGenerationBatches();
  },

  internal_dispatchGenerationBatch: (topicId, payload, action) => {
    const currentBatches = get().generationBatchesMap[topicId] || [];
    const nextBatches = generationBatchReducer(currentBatches, payload);

    const nextMap = {
      ...get().generationBatchesMap,
      [topicId]: nextBatches,
    };

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

  removeGeneration: async (generationId: string) => {
    const { internal_deleteGeneration, activeGenerationTopicId, internal_deleteGenerationBatch } =
      get();

    await internal_deleteGeneration(generationId);

    // Video batch has only 1 generation, so delete the batch directly
    if (activeGenerationTopicId) {
      const updatedBatches = get().generationBatchesMap[activeGenerationTopicId] || [];
      const emptyBatches = updatedBatches.filter((batch) => batch.generations.length === 0);

      for (const emptyBatch of emptyBatches) {
        await internal_deleteGenerationBatch(emptyBatch.id, activeGenerationTopicId);
      }
    }
  },

  removeGenerationBatch: async (batchId: string, topicId: string) => {
    const { internal_deleteGenerationBatch } = get();
    await internal_deleteGenerationBatch(batchId, topicId);
  },

  setTopicBatchLoaded: (topicId: string) => {
    const nextMap = {
      ...get().generationBatchesMap,
      [topicId]: [],
    };

    if (isEqual(nextMap, get().generationBatchesMap)) return;

    set(
      {
        generationBatchesMap: nextMap,
      },
      false,
      n('setTopicBatchLoaded'),
    );
  },

  useCheckGenerationStatus: (generationId, asyncTaskId, topicId, enable = true) => {
    const requestCountRef = useRef(0);
    const isErrorRef = useRef(false);

    return useClientDataSWR<GetGenerationStatusResult>(
      enable && generationId && !generationId.startsWith('temp-') && asyncTaskId
        ? [SWR_USE_CHECK_GENERATION_STATUS, generationId, asyncTaskId]
        : null,
      async ([, generationId, asyncTaskId]: [string, string, string]) => {
        requestCountRef.current += 1;
        return generationService.getGenerationStatus(generationId, asyncTaskId);
      },
      {
        onError: (error) => {
          isErrorRef.current = true;
          console.error('Video generation status check error:', error);
        },
        onSuccess: async (data: GetGenerationStatusResult) => {
          if (!data) return;

          isErrorRef.current = false;

          const currentBatches = get().generationBatchesMap[topicId] || [];
          const targetBatch = currentBatches.find((batch) =>
            batch.generations.some((gen) => gen.id === generationId),
          );

          if (
            (data.status === AsyncTaskStatus.Success || data.status === AsyncTaskStatus.Error) &&
            targetBatch
          ) {
            requestCountRef.current = 0;

            if (data.generation) {
              get().internal_dispatchGenerationBatch(
                topicId,
                {
                  batchId: targetBatch.id,
                  generationId,
                  type: 'updateGenerationInBatch',
                  value: data.generation,
                },
                n(
                  `useCheckGenerationStatus/${data.status === AsyncTaskStatus.Success ? 'success' : 'error'}`,
                ),
              );

              // Update topic cover if generation succeeds and has a thumbnail
              if (data.status === AsyncTaskStatus.Success && data.generation.asset?.thumbnailUrl) {
                const currentTopic =
                  generationTopicSelectors.getGenerationTopicById(topicId)(get());

                if (currentTopic && !currentTopic.coverUrl) {
                  await get().updateGenerationTopicCover(
                    topicId,
                    data.generation.asset.thumbnailUrl,
                  );
                }
              }
            }

            await get().refreshGenerationBatches();
          }
        },
        refreshInterval: (data: GetGenerationStatusResult | undefined) => {
          if (data?.status === AsyncTaskStatus.Success || data?.status === AsyncTaskStatus.Error) {
            return 0;
          }

          const baseInterval = 1000;
          const maxInterval = 30_000;
          const currentCount = requestCountRef.current;

          const backoffMultiplier = Math.floor(currentCount / 5);
          let dynamicInterval = Math.min(
            baseInterval * Math.pow(2, backoffMultiplier),
            maxInterval,
          );

          if (isErrorRef.current) {
            dynamicInterval = Math.min(dynamicInterval * 2, maxInterval);
          }

          return dynamicInterval;
        },
        refreshWhenHidden: false,
      },
    );
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
});
