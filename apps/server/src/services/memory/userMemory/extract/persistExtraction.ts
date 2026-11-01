import type {
  MemoryExtractionJob,
  MemoryExtractionResult,
  PersistedMemoryResult,
} from '@lobechat/memory-user-memory';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  layerEntriesHistogram,
  processedDurationHistogram,
  processedSourceCounter,
  tracer,
} from '@lobechat/observability-otel/modules/memory-user-memory';
import { attributesCommon } from '@lobechat/observability-otel/node';

import type { getServerDB } from '@/database/server';
import { LayersEnum } from '@/types/userMemory';

import { LAYER_LABEL_MAP } from './constants';
import type { MemoryExtractionExecutorContext } from './context';
import type { MemoryExtractionTaskErrorItem } from './errors';
import { makeTaskErrorItem, MemoryExtractionAggregateError } from './errors';
import type { PersistLayerResult, ResolvedMemoryServiceConfig, RuntimeBundle } from './types';

export function recordJobMetrics(
  job: MemoryExtractionJob,
  status: 'completed' | 'failed',
  durationMs: number,
) {
  processedSourceCounter.add(1, {
    source: job.source,
    status,
    user_id: job.userId,
    ...attributesCommon(),
  });
  processedDurationHistogram.record(durationMs, {
    source: job.source,
    user_id: job.userId,
    ...attributesCommon(),
  });
}

export function recordLayerEntries(job: MemoryExtractionJob, layer: LayersEnum, count: number) {
  layerEntriesHistogram.record(count, {
    layer: LAYER_LABEL_MAP[layer],
    source: job.source,
    user_id: job.userId,
    ...attributesCommon(),
  });
}

export function normalizeLayerError(
  layer: LayersEnum,
  stage: 'extract' | 'persist',
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`[${stage}] ${LAYER_LABEL_MAP[layer]}: ${message}`);
}

export async function persistExtraction(
  ctx: MemoryExtractionExecutorContext,
  job: MemoryExtractionJob,
  messageIds: string[],
  extraction: MemoryExtractionResult,
  runtimes: RuntimeBundle,
  memoryServiceConfig: ResolvedMemoryServiceConfig,
  db: Awaited<ReturnType<typeof getServerDB>>,
): Promise<PersistedMemoryResult> {
  const createdIds: string[] = [];
  const perLayer: Partial<Record<LayersEnum, number>> = {};
  const errors: MemoryExtractionTaskErrorItem[] = [];
  const appendError = (
    layer: LayersEnum,
    stage: 'extract' | 'persist',
    error: unknown,
    options?: { memoryIndex?: number; preview?: unknown },
  ) => {
    errors.push(
      makeTaskErrorItem(stage, ctx.normalizeLayerError(layer, stage, error), {
        layer: LAYER_LABEL_MAP[layer],
        memoryIndex: options?.memoryIndex,
        preview: options?.preview,
        sourceId: job.sourceId,
        sourceType: job.source,
      }),
    );
  };

  const persistWithSpan = async (
    layer: LayersEnum,
    persist: () => Promise<PersistLayerResult>,
  ): Promise<void> => {
    const attributes = {
      layer: LAYER_LABEL_MAP[layer],
      source: job.source,
      source_id: job.sourceId,
      user_id: job.userId,
      ...attributesCommon(),
    };

    await tracer.startActiveSpan(
      `Memory User Memory: Persist ${LAYER_LABEL_MAP[layer]}`,
      { attributes },
      async (span) => {
        try {
          const { errors: persistErrors, ids } = await persist();

          createdIds.push(...ids);
          perLayer[layer] = ids.length;
          errors.push(...persistErrors);
          ctx.recordLayerEntries(job, layer, ids.length);
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttribute('memory.persisted_count', ids.length);
        } catch (error) {
          appendError(layer, 'persist', error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message:
              error instanceof Error ? error.message : 'Failed to persist extracted memories',
          });
          span.recordException(error as Error);
          console.error(
            '[memory-extraction] failed to persist memories',
            error,
            'layer:',
            layer,
            'source:',
            job.source,
            'sourceId:',
            job.sourceId,
            'userId:',
            job.userId,
          );
        } finally {
          span.end();
        }
      },
    );
  };

  const activityOutput = extraction.outputs.activity;
  if (activityOutput?.error) {
    appendError(LayersEnum.Activity, 'extract', activityOutput.error);
  }
  if (activityOutput?.data) {
    await persistWithSpan(LayersEnum.Activity, () =>
      ctx.persistActivityMemories(
        job,
        messageIds,
        activityOutput.data,
        runtimes.embeddings,
        memoryServiceConfig.modelConfig.embeddingsModel,
        memoryServiceConfig.embeddingContextLimit,
        db,
      ),
    );
  }

  const contextOutput = extraction.outputs.context;
  if (contextOutput?.error) {
    appendError(LayersEnum.Context, 'extract', contextOutput.error);
  }
  if (contextOutput?.data) {
    await persistWithSpan(LayersEnum.Context, () =>
      ctx.persistContextMemories(
        job,
        messageIds,
        contextOutput.data,
        runtimes.embeddings,
        memoryServiceConfig.modelConfig.embeddingsModel,
        memoryServiceConfig.embeddingContextLimit,
        db,
      ),
    );
  }

  const experienceOutput = extraction.outputs.experience;
  if (experienceOutput?.error) {
    appendError(LayersEnum.Experience, 'extract', experienceOutput.error);
  }
  if (experienceOutput?.data) {
    await persistWithSpan(LayersEnum.Experience, () =>
      ctx.persistExperienceMemories(
        job,
        messageIds,
        experienceOutput.data,
        runtimes.embeddings,
        memoryServiceConfig.modelConfig.embeddingsModel,
        memoryServiceConfig.embeddingContextLimit,
        db,
      ),
    );
  }

  const preferenceOutput = extraction.outputs.preference;
  if (preferenceOutput?.error) {
    appendError(LayersEnum.Preference, 'extract', preferenceOutput.error);
  }
  if (preferenceOutput?.data) {
    await persistWithSpan(LayersEnum.Preference, () =>
      ctx.persistPreferenceMemories(
        job,
        messageIds,
        preferenceOutput.data,
        runtimes.embeddings,
        memoryServiceConfig.modelConfig.embeddingsModel,
        memoryServiceConfig.embeddingContextLimit,
        db,
      ),
    );
  }

  const identityOutput = extraction.outputs.identity;
  if (identityOutput?.error) {
    appendError(LayersEnum.Identity, 'extract', identityOutput.error);
  }
  if (identityOutput?.data) {
    await persistWithSpan(LayersEnum.Identity, () =>
      ctx.persistIdentityMemories(
        job,
        messageIds,
        identityOutput.data,
        runtimes.embeddings,
        memoryServiceConfig.modelConfig.embeddingsModel,
        memoryServiceConfig.embeddingContextLimit,
        db,
      ),
    );
  }

  if (errors.length) {
    const detail = errors.map((error) => error.message).join('; ');
    throw new MemoryExtractionAggregateError(
      `Memory extraction encountered layer errors: ${detail}`,
      errors,
    );
  }

  return {
    createdIds,
    layers: perLayer,
  };
}
