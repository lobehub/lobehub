import { isEqual } from 'es-toolkit/compat';
import { useRef } from 'react';
import { type SWRResponse } from 'swr';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { useClientDataSWR } from '@/libs/swr';
import { videoKeys } from '@/libs/swr/keys';
import { type GetGenerationStatusResult } from '@/server/routers/lambda/generation';
import { generationService } from '@/services/generation';
import { generationBatchService } from '@/services/generationBatch';
import { type StoreSetter } from '@/store/types';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type GenerationBatch } from '@/types/generation';
import { setNamespace } from '@/utils/storeDebug';

import { type VideoStore } from '../../store';
import { generationTopicSelectors } from '../generationTopic/selectors';
import { generationBatchesResource } from './projection';
import { type GenerationBatchDispatch, generationBatchReducer } from './reducer';

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

type Setter = StoreSetter<VideoStore>;

export const createGenerationBatchSlice = (set: Setter, get: () => VideoStore, _api?: unknown) =>
  new GenerationBatchActionImpl(set, get, _api);

export class GenerationBatchActionImpl {
  readonly #batches;
  readonly #get: () => VideoStore;

  constructor(set: Setter, get: () => VideoStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#batches = createReplicaSlice(generationBatchesResource, {
      actionPrefix: n('generationBatches'),
      fetcher: ({ topicId }) => generationBatchService.getGenerationBatches(topicId, 'video'),
      get,
      // An unchanged topic list must not re-render the feed.
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'generationBatchesReplica',
      view: recordLens<VideoStore, GenerationBatch[]>('generationBatchesMap'),
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
    const { internal_deleteGeneration, activeGenerationTopicId, internal_deleteGenerationBatch } =
      this.#get();

    await internal_deleteGeneration(generationId);

    if (this.#get().editingGenerationId === generationId) this.#get().cancelEditingVideo();

    // Video batch has only 1 generation, so delete the batch directly
    if (activeGenerationTopicId) {
      const updatedBatches = this.#get().generationBatchesMap[activeGenerationTopicId] || [];
      const emptyBatches = updatedBatches.filter((batch) => batch.generations.length === 0);

      for (const emptyBatch of emptyBatches) {
        await internal_deleteGenerationBatch(emptyBatch.id, activeGenerationTopicId);
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
    const { editingGenerationId, generationBatchesMap, internal_deleteGenerationBatch } =
      this.#get();
    const containsEditingSource =
      !!editingGenerationId &&
      !!generationBatchesMap[topicId]
        ?.find((batch) => batch.id === batchId)
        ?.generations.some((generation) => generation.id === editingGenerationId);

    await internal_deleteGenerationBatch(batchId, topicId);

    if (containsEditingSource) this.#get().cancelEditingVideo();
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
    enable = true,
  ): SWRResponse<GetGenerationStatusResult> => {
    const requestCountRef = useRef(0);
    const isErrorRef = useRef(false);

    return useClientDataSWR<GetGenerationStatusResult>(
      enable && generationId && !generationId.startsWith('temp-') && asyncTaskId
        ? videoKeys.generationStatus(generationId, asyncTaskId)
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

          const currentBatches = this.#get().generationBatchesMap[topicId] || [];
          const targetBatch = currentBatches.find((batch) =>
            batch.generations.some((gen) => gen.id === generationId),
          );

          if (
            (data.status === AsyncTaskStatus.Success || data.status === AsyncTaskStatus.Error) &&
            targetBatch
          ) {
            requestCountRef.current = 0;

            if (data.generation) {
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

            await this.#get().refreshGenerationBatches();
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
  };
}

export type GenerationBatchAction = Pick<
  GenerationBatchActionImpl,
  keyof GenerationBatchActionImpl
>;
