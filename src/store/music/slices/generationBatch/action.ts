import { isEqual } from 'es-toolkit/compat';
import { useEffect } from 'react';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { type GetGenerationStatusResult } from '@/server/routers/lambda/generation';
import { generationService } from '@/services/generation';
import { generationBatchService } from '@/services/generationBatch';
import { type StoreSetter } from '@/store/types';
import { getGenerationStatusPollingInterval } from '@/store/utils/generationStatusPolling';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type GenerationBatch } from '@/types/generation';
import { setNamespace } from '@/utils/storeDebug';

import { type MusicStore } from '../../store';
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

type Setter = StoreSetter<MusicStore>;

export const createGenerationBatchSlice = (set: Setter, get: () => MusicStore, _api?: unknown) =>
  new GenerationBatchActionImpl(set, get, _api);

export class GenerationBatchActionImpl {
  readonly #batches;
  readonly #get: () => MusicStore;

  constructor(set: Setter, get: () => MusicStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#batches = createReplicaSlice(generationBatchesResource, {
      actionPrefix: n('generationBatches'),
      fetcher: ({ topicId }) => generationBatchService.getGenerationBatches(topicId, 'music'),
      get,
      // An unchanged topic list must not re-render the feed.
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'generationBatchesReplica',
      view: recordLens<MusicStore, GenerationBatch[]>('generationBatchesMap'),
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

    // A batch can hold several songs; drop it once its last song is deleted
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
    await this.#get().internal_deleteGenerationBatch(batchId, topicId);
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

  /**
   * Apply one status result: a settled task replaces its generation in the batch replica and the
   * batches revalidate so every song of the batch shows its final state.
   */
  internal_applyGenerationStatus = async (
    topicId: string,
    generationId: string,
    data: GetGenerationStatusResult,
  ): Promise<void> => {
    if (data.status !== AsyncTaskStatus.Success && data.status !== AsyncTaskStatus.Error) return;

    const currentBatches = this.#get().generationBatchesMap[topicId] || [];
    const targetBatch = currentBatches.find((batch) =>
      batch.generations.some((gen) => gen.id === generationId),
    );
    if (!targetBatch) return;

    if (data.generation) {
      this.#get().internal_dispatchGenerationBatch(topicId, {
        batchId: targetBatch.id,
        generationId,
        type: 'updateGenerationInBatch',
        value: data.generation,
      });
    }

    await this.#get().refreshGenerationBatches();
  };

  /**
   * Poll a song's async task until it settles. Uses the shared generation status endpoint with
   * the image/video backoff; a plain effect loop instead of an SWR key, since the SWR key
   * registry is frozen.
   */
  useCheckGenerationStatus = (
    generationId: string,
    asyncTaskId: string,
    topicId: string,
    enable = true,
  ): void => {
    const shouldPoll =
      enable && !!generationId && !generationId.startsWith('temp-') && !!asyncTaskId;

    useEffect(() => {
      if (!shouldPoll) return;

      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let requestCount = 0;
      let hasError = false;

      const tick = async () => {
        // A hidden tab skips the request and checks again later, like SWR's refreshWhenHidden
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          timer = setTimeout(tick, getGenerationStatusPollingInterval({ hasError, requestCount }));
          return;
        }

        let status: AsyncTaskStatus | undefined;
        try {
          requestCount += 1;
          const data = await generationService.getGenerationStatus(generationId, asyncTaskId);
          hasError = false;
          status = data?.status;
          if (!cancelled && data) {
            await this.#get().internal_applyGenerationStatus(topicId, generationId, data);
          }
        } catch (error) {
          hasError = true;
          console.error('Music generation status check error:', error);
        }

        if (cancelled) return;
        const interval = getGenerationStatusPollingInterval({ hasError, requestCount, status });
        if (interval > 0) timer = setTimeout(tick, interval);
      };

      timer = setTimeout(tick, getGenerationStatusPollingInterval({ hasError, requestCount }));

      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, [shouldPoll, generationId, asyncTaskId, topicId]);
  };
}

export type GenerationBatchAction = Pick<
  GenerationBatchActionImpl,
  keyof GenerationBatchActionImpl
>;
