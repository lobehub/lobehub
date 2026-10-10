import { isEqual } from 'es-toolkit/compat';
import { useRef } from 'react';
import { type SWRResponse } from 'swr';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { useClientDataSWR } from '@/libs/swr';
import { imageKeys } from '@/libs/swr/keys';
import { type GetGenerationStatusResult } from '@/server/routers/lambda/generation';
import { generationService } from '@/services/generation';
import { generationBatchService } from '@/services/generationBatch';
import { type StoreSetter } from '@/store/types';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type GenerationBatch } from '@/types/generation';
import { setNamespace } from '@/utils/storeDebug';

import { type ImageStore } from '../../store';
import { generationTopicSelectors } from '../generationTopic/selectors';
import { generationBatchesResource } from './projection';
import { type GenerationBatchDispatch } from './reducer';
import { generationBatchReducer } from './reducer';

const n = setNamespace('generationBatch');

/**
 * Result of the per-topic batch sync. `data` mirrors the SWR-era shape the
 * shared generation workspace reads (`error` / `mutate`); read the batches
 * through `generationBatchSelectors` and treat `mutate` as an alias of
 * `revalidate`.
 */
export interface GenerationBatchesSyncResult extends ReplicaSyncResult {
  data?: GenerationBatch[];
  /** A request is in flight and this topic has never loaded. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
}

type Setter = StoreSetter<ImageStore>;
export const createGenerationBatchSlice = (set: Setter, get: () => ImageStore, _api?: unknown) =>
  new GenerationBatchActionImpl(set, get, _api);

export class GenerationBatchActionImpl {
  readonly #batches;
  readonly #get: () => ImageStore;

  constructor(set: Setter, get: () => ImageStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#batches = createReplicaSlice(generationBatchesResource, {
      actionPrefix: n('generationBatches'),
      fetcher: ({ topicId }) => generationBatchService.getGenerationBatches(topicId, 'image'),
      get,
      // An unchanged topic list must not re-render the feed.
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'generationBatchesReplica',
      view: recordLens<ImageStore, GenerationBatch[]>('generationBatchesMap'),
    });
  }

  /**
   * Seed an empty list for a just-created topic so the workspace paints the
   * empty state instead of a skeleton while the first batch request is in
   * flight. Memory-only: the server confirmation persists the real value.
   */
  setTopicBatchLoaded = (topicId: string): void => {
    this.#batches.update(topicId, (batches) => (Array.isArray(batches) ? batches : []), {
      persist: false,
    });
  };

  removeGeneration = async (generationId: string): Promise<void> => {
    const { internal_deleteGeneration, activeGenerationTopicId, refreshGenerationBatches } =
      this.#get();

    await internal_deleteGeneration(generationId);

    // Check if any batch becomes empty after deletion, and if so, delete the empty batch
    if (activeGenerationTopicId) {
      const updatedBatches = this.#get().generationBatchesMap[activeGenerationTopicId] || [];
      const emptyBatches = updatedBatches.filter((batch) => batch.generations.length === 0);

      // Delete all empty batches
      for (const emptyBatch of emptyBatches) {
        await this.#get().internal_deleteGenerationBatch(emptyBatch.id, activeGenerationTopicId);
      }

      // If empty batches were deleted, refresh data again to ensure consistency
      if (emptyBatches.length > 0) {
        await refreshGenerationBatches();
      }
    }
  };

  /**
   * Remove a generation optimistically (the whole empty batch is cleaned up by
   * `removeGeneration`), roll back if the server rejects, and revalidate so the
   * confirmed list wins.
   */
  internal_deleteGeneration = async (generationId: string): Promise<void> => {
    const activeGenerationTopicId = this.#get().activeGenerationTopicId;
    if (!activeGenerationTopicId) return;

    // Find the batch containing this generation
    const currentBatches = this.#get().generationBatchesMap[activeGenerationTopicId] ?? [];
    const targetBatch = currentBatches.find((batch) =>
      batch.generations.some((gen) => gen.id === generationId),
    );

    if (!targetBatch) return;

    await this.#batches.optimistic(
      activeGenerationTopicId,
      (batches) =>
        generationBatchReducer(batches, {
          batchId: targetBatch.id,
          generationId,
          type: 'deleteGenerationInBatch',
        }),
      () => generationService.deleteGeneration(generationId),
      { revalidate: true },
    );
  };

  removeGenerationBatch = async (batchId: string, topicId: string): Promise<void> => {
    const { internal_deleteGenerationBatch } = this.#get();
    await internal_deleteGenerationBatch(batchId, topicId);
  };

  internal_deleteGenerationBatch = async (batchId: string, topicId: string): Promise<void> => {
    await this.#batches.optimistic(
      topicId,
      (batches) => generationBatchReducer(batches, { id: batchId, type: 'deleteBatch' }),
      () => generationBatchService.deleteGenerationBatch(batchId),
      { revalidate: true },
    );
  };

  /**
   * Optimistic write into the batch replica of one topic. Memory-only — live
   * status updates are confirmed by the follow-up `refreshGenerationBatches`.
   * A topic that has not loaded yet is left untouched.
   */
  internal_dispatchGenerationBatch = (topicId: string, payload: GenerationBatchDispatch): void => {
    this.#batches.update(
      topicId,
      (batches) => (batches ? generationBatchReducer(batches, payload) : batches),
      { persist: false },
    );
  };

  refreshGenerationBatches = async (): Promise<void> => {
    const { activeGenerationTopicId } = this.#get();
    if (activeGenerationTopicId) {
      await this.#batches.revalidate(activeGenerationTopicId);
    }
  };

  /**
   * Fetch orchestration for the active topic's batches. The batches are read
   * through `generationBatchSelectors`, not from this return value.
   */
  useFetchGenerationBatches = (topicId?: string | null): GenerationBatchesSyncResult => {
    const sync = this.#batches.useSync(topicId ? { topicId } : undefined, { enabled: !!topicId });
    const data = topicId ? this.#get().generationBatchesMap[topicId] : undefined;

    return {
      data,
      error: sync.error,
      isHydrated: sync.isHydrated,
      isLoading: sync.isValidating && data === undefined,
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
      revalidate: sync.revalidate,
    };
  };

  useCheckGenerationStatus = (
    generationId: string,
    asyncTaskId: string,
    topicId: string,
    enable: boolean = true,
  ): SWRResponse<GetGenerationStatusResult> => {
    const requestCountRef = useRef(0);
    const isErrorRef = useRef(false);

    return useClientDataSWR<GetGenerationStatusResult>(
      enable && generationId && !generationId.startsWith('temp-') && asyncTaskId
        ? imageKeys.generationStatus(generationId, asyncTaskId)
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

          // Find the corresponding batch; the generation database record contains generationBatchId
          const currentBatches = this.#get().generationBatchesMap[topicId] || [];
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
              this.#get().internal_dispatchGenerationBatch(topicId, {
                batchId: targetBatch.id,
                generationId,
                type: 'updateGenerationInBatch',
                value: data.generation,
              });

              // The server fills an empty topic cover before reporting success; refresh to show it
              if (data.status === AsyncTaskStatus.Success && data.generation.asset?.thumbnailUrl) {
                const currentTopic = generationTopicSelectors.getGenerationTopicById(topicId)(
                  this.#get(),
                );

                if (currentTopic && !currentTopic.coverUrl) {
                  await this.#get().refreshGenerationTopics();
                }
              }
            }

            // Refresh generation batches after success or failure
            await this.#get().refreshGenerationBatches();
          }
        },
      },
    );
  };
}

export type GenerationBatchAction = Pick<
  GenerationBatchActionImpl,
  keyof GenerationBatchActionImpl
>;
