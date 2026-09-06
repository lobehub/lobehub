// @vitest-environment node
import type { FtsSearchDocumentEntity } from '@lobechat/types';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FtsSearchDocumentRepository from '../../../../packages/database/src/repositories/ftsSearchDocument';
import {
  buildFtsSearchIndexMeta,
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  getFtsSearchIndexSchemaFingerprint,
  getFtsSearchPhysicalIndexName,
} from '../../../../packages/database/src/repositories/ftsSearchDocument';
import type { FtsSearchReindexFailure, FtsSearchReindexRunState } from '../checkpointRepository';
import type { FtsSearchReindexGenerationDescription } from '../elasticsearchClient';
import type {
  FtsSearchReindexElasticsearchClient,
  FtsSearchReindexProgressEvent,
  FtsSearchReindexStateRepository,
} from '../reindexService';
import { FtsSearchReindexEntityError, FtsSearchReindexService } from '../reindexService';

/**
 * Every real search entity currently declares schema version 1, so overriding one entity's declared
 * version is the only way to exercise a checkpoint generation that an entity has already left.
 */
const { declaredSchemaVersions } = vi.hoisted(() => ({
  declaredSchemaVersions: new Map<string, number>(),
}));

vi.mock(
  '../../../../packages/database/src/repositories/ftsSearchDocument',
  async (importActual) => {
    const actual = await importActual<typeof FtsSearchDocumentRepository>();
    return {
      ...actual,
      getFtsSearchIndexSchemaVersion: (entity: FtsSearchDocumentEntity) =>
        declaredSchemaVersions.get(entity) ?? actual.getFtsSearchIndexSchemaVersion(entity),
    };
  },
);

const createState = (): FtsSearchReindexRunState => ({
  progress: FTS_SEARCH_DOCUMENT_ENTITIES.map((entity) => ({
    completedAt: null,
    cursor: null,
    entity,
    failedCount: 0,
    indexedCount: 0,
    physicalIndex: getFtsSearchPhysicalIndexName('test', entity, 1),
    processedCount: 0,
    status: 'pending',
  })),
  run: {
    aliasesCreatedAt: null,
    backfillHighWaterRevision: null,
    baseRevision: 10,
    captureFingerprint: 'capture-v1',
    createdAt: '2026-08-28T00:00:00.000Z',
    id: 'run-1',
    namespace: 'test',
    schemaVersion: 1,
    status: 'backfilling',
    updatedAt: '2026-08-28T00:00:00.000Z',
  },
});

type FtsSearchReindexLiveMappings = NonNullable<FtsSearchReindexGenerationDescription['mappings']>;

/**
 * Mapping the live `topics` index reports back: the declared field set minus `description`, so the
 * declared generation only adds one top-level field and stays applicable in place.
 */
const upgradableTopicsMappings = (): FtsSearchReindexLiveMappings => {
  const mappings = structuredClone(
    FTS_SEARCH_INDEX_DEFINITIONS.topics.mappings,
  ) as unknown as FtsSearchReindexLiveMappings;
  delete mappings.properties.description;
  return mappings;
};

/** Generation description Elasticsearch reports for an open index the alias serves for writes. */
const createGeneration = (
  index: string,
  overrides: Partial<FtsSearchReindexGenerationDescription> = {},
): FtsSearchReindexGenerationDescription => ({
  aliased: true,
  analysis: structuredClone(FTS_SEARCH_INDEX_ANALYSIS) as unknown as Record<string, unknown>,
  index,
  isWriteIndex: true,
  mappings: null,
  meta: null,
  state: 'open',
  version: 1,
  ...overrides,
});

const createLiveTopicsGeneration = (
  overrides: Partial<FtsSearchReindexGenerationDescription> = {},
) =>
  createGeneration('test-topics-v1', {
    mappings: upgradableTopicsMappings(),
    meta: buildFtsSearchIndexMeta('topics', 'run-0'),
    ...overrides,
  });

/**
 * Turns the state into a v2 generation that upgrades `topics` in place: every other entity targets
 * its rebuilt v2 index while `topics` stays pinned to the v1 index the alias already serves.
 */
const pinTopicsInPlace = (state: FtsSearchReindexRunState) => {
  declaredSchemaVersions.set('topics', 2);
  state.run.schemaVersion = 2;
  for (const progress of state.progress) {
    progress.physicalIndex = getFtsSearchPhysicalIndexName('test', progress.entity, 2);
  }
  const topics = state.progress.find(({ entity }) => entity === 'topics')!;
  topics.physicalIndex = getFtsSearchPhysicalIndexName('test', 'topics', 1);
  return topics;
};

const createFailure = (
  entity: FtsSearchDocumentEntity,
  documentId: string,
): FtsSearchReindexFailure => ({
  attempts: 1,
  documentId,
  entity,
  error: 'retryable failure',
  resolvedAt: null,
  retryable: true,
});

const createDependencies = () => {
  const state = createState();
  const failures = new Map<FtsSearchDocumentEntity, { documentId: string }[]>();
  const builder = {
    buildBatch: vi.fn().mockResolvedValue([]),
    buildByIds: vi.fn().mockResolvedValue([]),
    buildRangeBatch: vi.fn().mockResolvedValue([]),
  };
  const client: FtsSearchReindexElasticsearchClient = {
    bulk: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    describeGenerations: vi.fn().mockResolvedValue([]),
    ensureAlias: vi.fn().mockResolvedValue('created'),
    ensureIndex: vi.fn().mockResolvedValue(undefined),
    putMapping: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const repository: FtsSearchReindexStateRepository = {
    checkpointBatch: vi.fn(
      async (checkpoint: Parameters<FtsSearchReindexStateRepository['checkpointBatch']>[0]) => {
        const progress = state.progress.find(({ entity }) => entity === checkpoint.entity)!;
        if (progress.cursor !== checkpoint.previousCursor) return false;
        progress.cursor = checkpoint.cursor;
        progress.processedCount += checkpoint.processedCount;
        progress.indexedCount += checkpoint.indexedCount;
        failures.set(
          checkpoint.entity,
          checkpoint.failures.map(({ documentId }) => ({ documentId })),
        );
        progress.failedCount = failures.get(checkpoint.entity)?.length ?? 0;
        return true;
      },
    ),
    completeEntity: vi.fn(async (_runId, entity) => {
      state.progress.find((item) => item.entity === entity)!.status = 'completed';
    }),
    createOrResume: vi.fn().mockResolvedValue(state),
    getRun: vi.fn().mockImplementation(async () => state),
    listUnresolvedFailures: vi
      .fn()
      .mockImplementation(async (_runId, entity) => failures.get(entity) ?? []),
    markReadyForIncrementalSync: vi.fn(async () => {
      state.run.status = 'ready_for_incremental_sync';
    }),
    resolveFailures: vi.fn().mockResolvedValue(0),
  };
  return { builder, client, repository, state };
};

beforeEach(() => {
  declaredSchemaVersions.clear();
  vi.clearAllMocks();
});

describe('FtsSearchReindexService', () => {
  it('uses defaults when optional batch limits are undefined', async () => {
    const { builder, client, repository } = createDependencies();
    const service = new FtsSearchReindexService(builder, repository, client, {
      batchSize: undefined,
      bulkMaxBytes: undefined,
    });

    await expect(service.run('test', 1)).resolves.toMatchObject({
      status: 'ready_for_incremental_sync',
    });
  });

  it('uses an entity page-size override for paging and source exhaustion', async () => {
    const { builder, client, repository } = createDependencies();
    builder.buildBatch.mockImplementation(async (entity, { afterId }) => {
      if (entity !== 'documents') return [];
      if (!afterId) {
        return [{ entity, id: 'document-1', source: { id: 'document-1' } }];
      }
      if (afterId === 'document-1') {
        return [{ entity, id: 'document-2', source: { id: 'document-2' } }];
      }
      return [];
    });
    vi.mocked(client.bulk).mockResolvedValue([{ status: 201 }]);
    vi.mocked(client.count).mockImplementation(async (index) =>
      index === getFtsSearchPhysicalIndexName('test', 'documents', 1) ? 2 : 0,
    );
    const service = new FtsSearchReindexService(builder, repository, client, {
      batchSize: 2,
      batchSizeByEntity: { documents: 1 },
      entityConcurrency: 1,
    });

    await service.run('test', 1);

    expect(builder.buildBatch).toHaveBeenCalledWith('documents', {
      afterId: undefined,
      limit: 1,
    });
    expect(builder.buildBatch).toHaveBeenCalledWith('documents', {
      afterId: 'document-1',
      limit: 1,
    });
    expect(builder.buildBatch).toHaveBeenCalledWith('documents', {
      afterId: 'document-2',
      limit: 1,
    });
    expect(builder.buildBatch).toHaveBeenCalledWith('messages', {
      afterId: undefined,
      limit: 2,
    });
  });

  it('rejects an invalid entity page-size override', () => {
    const { builder, client, repository } = createDependencies();

    expect(
      () =>
        new FtsSearchReindexService(builder, repository, client, {
          batchSizeByEntity: { documents: 0 },
        }),
    ).toThrow('batch size for documents must be a positive integer');
  });

  it('indexes high-volume ID ranges concurrently but checkpoints them in order', async () => {
    const { builder, client, repository, state } = createDependencies();
    for (const progress of state.progress) progress.status = 'completed';
    const messageProgress = state.progress.find(({ entity }) => entity === 'messages')!;
    messageProgress.cursor = 'msg_00AAAA';
    messageProgress.status = 'backfilling';

    builder.buildRangeBatch.mockImplementation(async (entity, { afterId, beforeId, fromId }) => {
      if (entity !== 'messages') return [];
      if (afterId === 'msg_00AAAA' && beforeId === 'msg_08') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [{ entity, id: 'msg_01AAAA', source: { id: 'msg_01AAAA' } }];
      }
      if (fromId === 'msg_08' && beforeId === 'msg_0G') {
        return [{ entity, id: 'msg_09AAAA', source: { id: 'msg_09AAAA' } }];
      }
      return [];
    });
    vi.mocked(client.bulk).mockResolvedValue([{ status: 201 }]);
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-messages-') ? 2 : 0,
    );
    const service = new FtsSearchReindexService(builder, repository, client, {
      batchSize: 10,
      entityConcurrency: 1,
      rangeConcurrencyByEntity: { messages: 2 },
    });

    await service.run('test', 1);

    const messageCheckpoints = vi
      .mocked(repository.checkpointBatch)
      .mock.calls.map(([checkpoint]) => checkpoint)
      .filter(({ entity }) => entity === 'messages');
    expect(messageCheckpoints.map(({ cursor }) => cursor)).toEqual(['msg_01AAAA', 'msg_09AAAA']);
    expect(messageProgress).toMatchObject({ indexedCount: 2, processedCount: 2 });
    expect(builder.buildBatch).not.toHaveBeenCalledWith('messages', expect.anything());
  });

  it('creates aliases only after all 14 entities complete', async () => {
    const { builder, client, repository, state } = createDependencies();
    const events: unknown[] = [];
    const lifecycle: string[] = [];
    const validateIncrementalSyncSource = vi.fn(async () => {
      lifecycle.push('validate-incremental-sync-source');
    });
    vi.mocked(client.ensureAlias).mockImplementation(async () => {
      lifecycle.push('create-alias');
      return 'created';
    });
    const service = new FtsSearchReindexService(builder, repository, client, {
      onProgress: (event) => {
        events.push(event);
      },
      validateIncrementalSyncSource,
    });

    await expect(service.run('test', 1)).resolves.toMatchObject({
      status: 'ready_for_incremental_sync',
    });

    expect(client.ensureIndex).toHaveBeenCalledTimes(14);
    expect(client.ensureIndex).toHaveBeenCalledWith(
      'test-agents-v1',
      expect.objectContaining({
        mappings: expect.objectContaining({
          _meta: {
            reindex_run_id: 'run-1',
            schema_fingerprint: getFtsSearchIndexSchemaFingerprint('agents'),
            schema_version: 1,
          },
        }),
      }),
      { createIfMissing: true },
    );
    expect(client.ensureAlias).toHaveBeenCalledTimes(14);
    expect(repository.markReadyForIncrementalSync).toHaveBeenCalledOnce();
    expect(state.progress.every(({ status }) => status === 'completed')).toBe(true);
    expect(events).toEqual(
      expect.arrayContaining(
        FTS_SEARCH_DOCUMENT_ENTITIES.map((entity) =>
          expect.objectContaining({ drift: 0, entity, type: 'reconciliation' }),
        ),
      ),
    );
    expect(validateIncrementalSyncSource).toHaveBeenCalledOnce();
    expect(lifecycle).toEqual([
      'validate-incremental-sync-source',
      ...Array.from({ length: 14 }, () => 'create-alias'),
    ]);
  });

  it('keeps a selected-entity run backfilling until every entity is complete', async () => {
    const { builder, client, repository, state } = createDependencies();
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['messages'],
    });

    await expect(service.run('test', 1)).resolves.toMatchObject({ status: 'backfilling' });

    expect(state.progress.find(({ entity }) => entity === 'messages')?.status).toBe('completed');
    expect(state.progress.find(({ entity }) => entity === 'documents')?.status).toBe('pending');
    expect(client.ensureAlias).not.toHaveBeenCalled();
    expect(repository.markReadyForIncrementalSync).not.toHaveBeenCalled();
  });

  it('does not create aliases or mark a run ready when incremental source validation fails', async () => {
    const { builder, client, repository } = createDependencies();
    const validateIncrementalSyncSource = vi
      .fn()
      .mockRejectedValue(new Error('incremental sync source is not healthy'));
    const service = new FtsSearchReindexService(builder, repository, client, {
      validateIncrementalSyncSource,
    });

    await expect(service.run('test', 1)).rejects.toThrow('incremental sync source is not healthy');

    expect(validateIncrementalSyncSource).toHaveBeenCalledOnce();
    expect(client.ensureAlias).not.toHaveBeenCalled();
    expect(repository.markReadyForIncrementalSync).not.toHaveBeenCalled();
  });

  it('does not mark a run ready when an existing alias blocks cutover', async () => {
    const { builder, client, repository } = createDependencies();
    vi.mocked(client.ensureAlias).mockRejectedValue(
      new Error('Elasticsearch alias test-agents already points to a different index'),
    );
    const service = new FtsSearchReindexService(builder, repository, client);

    await expect(service.run('test', 1)).rejects.toThrow(
      'Elasticsearch alias test-agents already points to a different index',
    );

    expect(client.ensureAlias).toHaveBeenCalledOnce();
    expect(repository.markReadyForIncrementalSync).not.toHaveBeenCalled();
  });

  it('reuses index preparation when the run already prepared it', async () => {
    const { builder, client, repository, state } = createDependencies();
    const service = new FtsSearchReindexService(builder, repository, client);

    await service.prepareIndices(state);
    await service.run('test', 1);

    expect(client.ensureIndex).toHaveBeenCalledTimes(14);
  });

  it('requires completed physical indexes to remain present', async () => {
    const { builder, client, repository, state } = createDependencies();
    const agents = state.progress.find(({ entity }) => entity === 'agents')!;
    agents.completedAt = '2026-08-28T00:01:00.000Z';
    agents.status = 'completed';
    const service = new FtsSearchReindexService(builder, repository, client);

    await service.prepareIndices(state);

    expect(client.ensureIndex).toHaveBeenCalledWith('test-agents-v1', expect.any(Object), {
      createIfMissing: false,
    });
  });

  it('attributes index preparation failures to their entity', async () => {
    const { builder, client, repository, state } = createDependencies();
    vi.mocked(client.ensureIndex).mockImplementation(async (index) => {
      if (index === 'test-agents-v1') throw new Error('analysis-icu is unavailable');
    });
    const service = new FtsSearchReindexService(builder, repository, client, {
      entityConcurrency: 1,
    });

    await expect(service.prepareIndices(state)).rejects.toMatchObject({
      entity: 'agents',
      message: expect.stringContaining('analysis-icu is unavailable'),
    });
  });

  it('backfills independent entities with bounded concurrency', async () => {
    const { builder, client, repository } = createDependencies();
    let active = 0;
    let maxActive = 0;
    vi.mocked(client.ensureIndex).mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });
    const service = new FtsSearchReindexService(builder, repository, client, {
      entityConcurrency: 4,
    });

    await service.run('test', 1);

    expect(maxActive).toBe(4);
  });

  it('writes byte-bounded bulk requests concurrently', async () => {
    const { builder, client, repository } = createDependencies();
    builder.buildBatch.mockImplementation(async (entity) => {
      if (entity !== 'agents' || builder.buildBatch.mock.calls.length > 1) return [];
      return Array.from({ length: 4 }, (_, index) => ({
        entity: 'agents' as const,
        id: `agent-${index}`,
        source: { content: 'x'.repeat(100), id: `agent-${index}` },
      }));
    });
    let active = 0;
    let maxActive = 0;
    vi.mocked(client.bulk).mockImplementation(async (body) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return Array.from({ length: body.trim().split('\n').length / 2 }, () => ({ status: 201 }));
    });
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-agents-') ? 4 : 0,
    );
    const service = new FtsSearchReindexService(builder, repository, client, {
      bulkConcurrency: 2,
      bulkMaxBytes: 250,
      entityConcurrency: 1,
    });

    await service.run('test', 1);

    expect(client.bulk).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(2);
  });

  it('includes PostgreSQL batch scan time in the reported batch duration', async () => {
    const { builder, client, repository } = createDependencies();
    const events: FtsSearchReindexProgressEvent[] = [];
    const scanDelayMs = 100;
    let returnedAgents = false;
    builder.buildBatch.mockImplementation(async (entity) => {
      if (entity !== 'agents' || returnedAgents) return [];
      returnedAgents = true;
      await new Promise((resolve) => setTimeout(resolve, scanDelayMs));
      return [{ entity: 'agents', id: 'agent-1', source: { id: 'agent-1' } }];
    });
    vi.mocked(client.bulk).mockResolvedValue([{ status: 201 }]);
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-agents-') ? 1 : 0,
    );
    const service = new FtsSearchReindexService(builder, repository, client, {
      entityConcurrency: 1,
      onProgress: (event) => {
        events.push(event);
      },
    });

    vi.useFakeTimers();
    try {
      const run = service.run('test', 1);
      await vi.advanceTimersByTimeAsync(scanDelayMs);
      await run;
    } finally {
      vi.useRealTimers();
    }

    const batch = events.find(
      (event): event is Extract<FtsSearchReindexProgressEvent, { type: 'batch' }> =>
        event.type === 'batch' && event.entity === 'agents',
    );
    expect(batch).toBeDefined();
    expect(batch!.durationMs).toBeGreaterThanOrEqual(scanDelayMs);
  });

  it('starts byte-bounded requests before encoding the remainder of a large batch', async () => {
    const { builder, client, repository } = createDependencies();
    let firstRequestStarted = false;
    let thirdDocumentEncodedAfterRequestStarted = false;
    builder.buildBatch.mockImplementation(async (entity) => {
      if (entity !== 'agents' || builder.buildBatch.mock.calls.length > 1) return [];
      return Array.from({ length: 3 }, (_, index) => ({
        entity: 'agents' as const,
        id: `agent-${index}`,
        source: {
          get content() {
            if (index === 2) {
              thirdDocumentEncodedAfterRequestStarted = firstRequestStarted;
            }
            return 'x'.repeat(100);
          },
          id: `agent-${index}`,
        },
      }));
    });
    vi.mocked(client.bulk).mockImplementation(async () => {
      firstRequestStarted = true;
      return [{ status: 201 }];
    });
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-agents-') ? 3 : 0,
    );
    const service = new FtsSearchReindexService(builder, repository, client, {
      bulkConcurrency: 2,
      bulkMaxBytes: 250,
    });

    await service.run('test', 1);

    expect(thirdDocumentEncodedAfterRequestStarted).toBe(true);
  });

  it('retries a request-level timeout before checkpointing the batch', async () => {
    const { builder, client, repository } = createDependencies();
    const events: unknown[] = [];
    builder.buildBatch
      .mockResolvedValueOnce([{ entity: 'agents', id: 'agent-1', source: { id: 'agent-1' } }])
      .mockResolvedValue([]);
    vi.mocked(client.bulk)
      .mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
      .mockResolvedValueOnce([{ status: 201 }]);
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-agents-') ? 1 : 0,
    );
    const service = new FtsSearchReindexService(builder, repository, client, {
      maxRequestRetries: 1,
      onProgress: (event) => {
        events.push(event);
      },
      retryBaseDelayMs: 0,
    });

    await expect(service.run('test', 1)).resolves.toMatchObject({
      status: 'ready_for_incremental_sync',
    });
    expect(client.bulk).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual(
      expect.objectContaining({ attempt: 1, entity: 'agents', type: 'bulk_retry' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        attempts: 2,
        entity: 'agents',
        result: 'success',
        type: 'bulk_completed',
      }),
    );
  });

  it('pauses every non-empty entity after a bounded number of batches', async () => {
    const { builder, client, repository, state } = createDependencies();
    const visited = new Set<FtsSearchDocumentEntity>();
    builder.buildBatch.mockImplementation(async (entity) => {
      if (visited.has(entity)) return [];
      visited.add(entity);
      return [{ entity, id: `${entity}-1`, source: { id: `${entity}-1` } }];
    });
    vi.mocked(client.bulk).mockResolvedValue([{ status: 201 }]);
    vi.mocked(client.count).mockResolvedValue(1);
    const service = new FtsSearchReindexService(builder, repository, client, {
      batchSize: 1,
      entityConcurrency: 4,
      maxBatchesPerEntity: 1,
    });

    await expect(service.run('test', 1)).resolves.toMatchObject({ status: 'backfilling' });

    expect(client.ensureAlias).not.toHaveBeenCalled();
    expect(state.progress.every(({ processedCount }) => processedCount === 1)).toBe(true);
    expect(state.progress.every(({ status }) => status !== 'completed')).toBe(true);
  });

  it('does not advance the cursor or create aliases after a request-level bulk failure', async () => {
    const { builder, client, repository, state } = createDependencies();
    const events: unknown[] = [];
    builder.buildBatch
      .mockResolvedValueOnce([{ entity: 'agents', id: 'agent-1', source: { id: 'agent-1' } }])
      .mockResolvedValue([]);
    vi.mocked(client.bulk).mockRejectedValueOnce(new Error('gateway unavailable'));
    const service = new FtsSearchReindexService(builder, repository, client, {
      maxRequestRetries: 0,
      onProgress: (event) => {
        events.push(event);
      },
    });

    await expect(service.run('test', 1)).rejects.toThrow('gateway unavailable');

    expect(repository.checkpointBatch).not.toHaveBeenCalled();
    expect(client.ensureAlias).not.toHaveBeenCalled();
    expect(state.progress[0].cursor).toBeNull();
    expect(events).toContainEqual(
      expect.objectContaining({
        attempts: 1,
        entity: 'agents',
        result: 'request_error',
        type: 'bulk_completed',
      }),
    );
  });

  it('replays a partially successful concurrent batch before advancing its cursor', async () => {
    const { builder, client, repository, state } = createDependencies();
    const documents = Array.from({ length: 2 }, (_, index) => ({
      entity: 'agents' as const,
      id: `agent-${index}`,
      source: { content: 'x'.repeat(100), id: `agent-${index}` },
    }));
    builder.buildBatch.mockImplementation(async (entity, { afterId }) =>
      entity === 'agents' && !afterId ? documents : [],
    );
    vi.mocked(client.bulk)
      .mockResolvedValueOnce([{ status: 201 }])
      .mockRejectedValueOnce(new Error('gateway unavailable'));
    const service = new FtsSearchReindexService(builder, repository, client, {
      bulkConcurrency: 2,
      bulkMaxBytes: 250,
      maxRequestRetries: 0,
    });

    await expect(service.run('test', 1)).rejects.toThrow('gateway unavailable');
    expect(repository.checkpointBatch).not.toHaveBeenCalled();
    expect(state.progress[0].cursor).toBeNull();

    vi.mocked(client.bulk).mockResolvedValue([{ status: 409 }]);
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-agents-') ? 2 : 0,
    );
    await expect(service.run('test', 1)).resolves.toMatchObject({
      status: 'ready_for_incremental_sync',
    });

    expect(repository.checkpointBatch).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'agent-1', indexedCount: 2, processedCount: 2 }),
    );
    expect(client.bulk).toHaveBeenCalledTimes(4);
  });

  it('retries large document failures in bounded projection batches', async () => {
    const { builder, client, repository, state } = createDependencies();
    for (const progress of state.progress) progress.status = 'completed';
    const documentProgress = state.progress.find(({ entity }) => entity === 'documents')!;
    documentProgress.failedCount = 21;
    documentProgress.status = 'backfilling';
    const failures = Array.from({ length: 21 }, (_, index) =>
      createFailure('documents', `document-${index}`),
    );
    vi.mocked(repository.listUnresolvedFailures)
      .mockResolvedValueOnce(failures)
      .mockResolvedValueOnce([]);
    vi.mocked(repository.resolveFailures).mockImplementation(async (_runId, _entity, ids) => {
      documentProgress.failedCount -= ids.length;
      documentProgress.indexedCount += ids.length;
      return ids.length;
    });
    builder.buildByIds.mockImplementation(async (entity, ids) =>
      ids.map((id: string) => ({ entity, id, source: { id } })),
    );
    vi.mocked(client.bulk).mockImplementation(async (body) =>
      Array.from({ length: body.trim().split('\n').length / 2 }, () => ({ status: 201 })),
    );
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-documents-') ? 21 : 0,
    );
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['documents'],
      entityConcurrency: 1,
    });

    await service.run('test', 1);

    expect(builder.buildByIds).toHaveBeenCalledTimes(2);
    expect(builder.buildByIds.mock.calls.map(([, ids]) => ids.length)).toEqual([20, 1]);
    expect(documentProgress).toMatchObject({ failedCount: 0, indexedCount: 21 });
  });

  it('retries retryable bulk items before persisting them again', async () => {
    const { builder, client, repository, state } = createDependencies();
    for (const progress of state.progress) progress.status = 'completed';
    const documentProgress = state.progress.find(({ entity }) => entity === 'documents')!;
    documentProgress.failedCount = 1;
    documentProgress.status = 'backfilling';
    vi.mocked(repository.listUnresolvedFailures)
      .mockResolvedValueOnce([createFailure('documents', 'document-1')])
      .mockResolvedValueOnce([]);
    vi.mocked(repository.resolveFailures).mockImplementation(async (_runId, _entity, ids) => {
      documentProgress.failedCount -= ids.length;
      documentProgress.indexedCount += ids.length;
      return ids.length;
    });
    builder.buildByIds.mockResolvedValue([
      { entity: 'documents', id: 'document-1', source: { id: 'document-1' } },
    ]);
    vi.mocked(client.bulk)
      .mockResolvedValueOnce([{ status: 429 }])
      .mockResolvedValueOnce([{ status: 201 }]);
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-documents-') ? 1 : 0,
    );
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['documents'],
      entityConcurrency: 1,
      maxRequestRetries: 1,
      retryBaseDelayMs: 0,
    });

    await service.run('test', 1);

    expect(client.bulk).toHaveBeenCalledTimes(2);
    expect(repository.checkpointBatch).not.toHaveBeenCalled();
    expect(documentProgress).toMatchObject({ failedCount: 0, indexedCount: 1 });
  });

  it('persists an oversized item and blocks alias creation', async () => {
    const { builder, client, repository } = createDependencies();
    builder.buildBatch
      .mockResolvedValueOnce([
        { entity: 'agents', id: 'agent-large', source: { id: 'agent-large', title: 'large' } },
      ])
      .mockResolvedValue([]);
    const service = new FtsSearchReindexService(builder, repository, client, { bulkMaxBytes: 1 });

    await expect(service.run('test', 1)).rejects.toThrow('unresolved agents failures');

    expect(repository.checkpointBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: 'agent-large',
        failures: [expect.objectContaining({ documentId: 'agent-large', retryable: false })],
      }),
    );
    expect(client.ensureAlias).not.toHaveBeenCalled();
  });

  it('treats an external version conflict as an already indexed document', async () => {
    const { builder, client, repository } = createDependencies();
    builder.buildBatch
      .mockResolvedValueOnce([{ entity: 'agents', id: 'agent-1', source: { id: 'agent-1' } }])
      .mockResolvedValue([]);
    vi.mocked(client.bulk).mockResolvedValueOnce([{ status: 409 }]);
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-agents-') ? 1 : 0,
    );
    const service = new FtsSearchReindexService(builder, repository, client);

    await expect(service.run('test', 1)).resolves.toMatchObject({
      status: 'ready_for_incremental_sync',
    });
    expect(repository.checkpointBatch).toHaveBeenCalledWith(
      expect.objectContaining({ failures: [], indexedCount: 1 }),
    );
  });

  it('emits signed reconciliation drift before blocking alias creation', async () => {
    const { client, repository } = createDependencies();
    const events: unknown[] = [];
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-agents-') ? 1 : 0,
    );
    const service = new FtsSearchReindexService(
      {
        buildBatch: vi.fn().mockResolvedValue([]),
        buildByIds: vi.fn().mockResolvedValue([]),
        buildRangeBatch: vi.fn().mockResolvedValue([]),
      },
      repository,
      client,
      {
        onProgress: (event) => {
          events.push(event);
        },
      },
    );

    await expect(service.run('test', 1)).rejects.toThrow('Reindex count mismatch for agents');

    expect(events).toContainEqual({
      checkpointCount: 0,
      drift: 1,
      elasticsearchCount: 1,
      entity: 'agents',
      type: 'reconciliation',
    });
    expect(client.ensureAlias).not.toHaveBeenCalled();
  });

  it('persists only a safe Elasticsearch error type, never its source-text reason', async () => {
    const { builder, client, repository } = createDependencies();
    builder.buildBatch
      .mockResolvedValueOnce([{ entity: 'agents', id: 'agent-1', source: { id: 'agent-1' } }])
      .mockResolvedValue([]);
    vi.mocked(client.bulk).mockResolvedValue([
      {
        error: { reason: 'private source text', type: 'mapper_parsing_exception' },
        status: 400,
      },
    ]);
    const service = new FtsSearchReindexService(builder, repository, client);

    await expect(service.run('test', 1)).rejects.toThrow('unresolved agents failures');

    const persistedErrors = vi
      .mocked(repository.checkpointBatch)
      .mock.calls.flatMap(([checkpoint]) => checkpoint.failures.map(({ error }) => String(error)));
    expect(persistedErrors).toContain(
      'Error: Elasticsearch bulk item failed (400, type=mapper_parsing_exception)',
    );
    expect(persistedErrors.join('\n')).not.toContain('private source text');
  });

  it('reports the entities whose alias still serves an older generation', async () => {
    const { builder, client, repository } = createDependencies();
    const events: FtsSearchReindexProgressEvent[] = [];
    const keptAliases = new Set(['test-agents', 'test-topics']);
    vi.mocked(client.ensureAlias).mockImplementation(async (alias) =>
      keptAliases.has(alias) ? 'kept_other_generation' : 'created',
    );
    const service = new FtsSearchReindexService(builder, repository, client, {
      onProgress: (event) => {
        events.push(event);
      },
    });

    await expect(service.run('test', 1)).resolves.toMatchObject({
      status: 'ready_for_incremental_sync',
    });

    expect(events).toContainEqual({ entities: ['agents', 'topics'], type: 'promotion_pending' });
    /** The remaining 12 aliases were created for this generation, so the cutover still happened. */
    expect(events).toContainEqual({ type: 'aliases_created' });
    expect(repository.markReadyForIncrementalSync).toHaveBeenCalledOnce();
  });

  it('does not announce a cutover when every alias still serves an older generation', async () => {
    const { builder, client, repository } = createDependencies();
    const events: FtsSearchReindexProgressEvent[] = [];
    vi.mocked(client.ensureAlias).mockResolvedValue('kept_other_generation');
    const service = new FtsSearchReindexService(builder, repository, client, {
      onProgress: (event) => {
        events.push(event);
      },
    });

    await expect(service.run('test', 1)).resolves.toMatchObject({
      status: 'ready_for_incremental_sync',
    });

    expect(events).toContainEqual({
      entities: [...FTS_SEARCH_DOCUMENT_ENTITIES],
      type: 'promotion_pending',
    });
    expect(events).not.toContainEqual({ type: 'aliases_created' });
  });

  it('emits no alias event when every alias already points at this generation', async () => {
    const { builder, client, repository } = createDependencies();
    const events: FtsSearchReindexProgressEvent[] = [];
    vi.mocked(client.ensureAlias).mockResolvedValue('existing');
    const service = new FtsSearchReindexService(builder, repository, client, {
      onProgress: (event) => {
        events.push(event);
      },
    });

    await expect(service.run('test', 1)).resolves.toMatchObject({
      status: 'ready_for_incremental_sync',
    });

    expect(client.ensureAlias).toHaveBeenCalledTimes(14);
    expect(repository.markReadyForIncrementalSync).toHaveBeenCalledOnce();
    expect(
      events.filter(({ type }) => type === 'aliases_created' || type === 'promotion_pending'),
    ).toEqual([]);
  });

  it('scopes the generation to the run entities and backfills only the selected ones', async () => {
    const { builder, client, repository, state } = createDependencies();
    const runEntities: FtsSearchDocumentEntity[] = ['topics', 'agents'];
    /** The checkpoint owns the generation, so it only hands back the requested entities. */
    state.progress = state.progress.filter(({ entity }) => runEntities.includes(entity));
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['topics'],
    });

    await expect(service.run('test', 1, runEntities)).resolves.toMatchObject({
      status: 'backfilling',
    });

    expect(repository.createOrResume).toHaveBeenCalledWith('test', 1, runEntities);
    expect(client.ensureIndex).toHaveBeenCalledTimes(2);
    expect(builder.buildBatch).toHaveBeenCalledOnce();
    expect(builder.buildBatch).toHaveBeenCalledWith('topics', { afterId: undefined, limit: 500 });
    expect(state.progress).toEqual([
      expect.objectContaining({ entity: 'agents', status: 'pending' }),
      expect.objectContaining({ entity: 'topics', status: 'completed' }),
    ]);
    expect(client.ensureAlias).not.toHaveBeenCalled();
  });

  it('skips an entity whose declared version moved to a newer generation', async () => {
    const { builder, client, repository, state } = createDependencies();
    declaredSchemaVersions.set('topics', 2);
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['agents'],
    });

    await service.prepareIndices(state);

    expect(client.ensureIndex).toHaveBeenCalledTimes(13);
    expect(client.ensureIndex).not.toHaveBeenCalledWith(
      'test-topics-v1',
      expect.anything(),
      expect.anything(),
    );
  });

  it('refuses to reuse an old generation for an entity that declared a new version', async () => {
    const { builder, client, repository, state } = createDependencies();
    declaredSchemaVersions.set('topics', 2);
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['topics'],
      entityConcurrency: 1,
    });

    await expect(service.prepareIndices(state)).rejects.toMatchObject({
      entity: 'topics',
      message: expect.stringContaining(
        'Checkpoint targets schema version 1 but the code declares v2 for topics',
      ),
    });
    expect(client.ensureIndex).not.toHaveBeenCalledWith(
      'test-topics-v1',
      expect.anything(),
      expect.anything(),
    );
  });

  it('adds the new fields to the live index instead of building the next generation', async () => {
    const { builder, client, repository, state } = createDependencies();
    pinTopicsInPlace(state);
    vi.mocked(client.describeGenerations).mockResolvedValue([createLiveTopicsGeneration()]);
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['topics'],
      entityConcurrency: 1,
    });

    await service.prepareIndices(state);

    expect(client.describeGenerations).toHaveBeenCalledWith('test-topics');
    expect(client.putMapping).toHaveBeenCalledOnce();
    /**
     * The upgrade restamps `_meta` from the declared definition, so the live index records the run
     * that widened it and the fingerprint of the mapping it now implements.
     */
    expect(client.putMapping).toHaveBeenCalledWith('test-topics-v1', {
      _meta: buildFtsSearchIndexMeta('topics', 'run-1'),
      properties: FTS_SEARCH_INDEX_DEFINITIONS.topics.mappings.properties,
    });
    expect(buildFtsSearchIndexMeta('topics', 'run-1')).toMatchObject({
      reindex_run_id: 'run-1',
      schema_fingerprint: getFtsSearchIndexSchemaFingerprint('topics'),
    });
    /** The pinned index already exists, so preparation must never recreate it. */
    expect(client.ensureIndex).toHaveBeenCalledOnce();
    expect(client.ensureIndex).toHaveBeenCalledWith('test-topics-v1', expect.any(Object), {
      createIfMissing: false,
    });
  });

  it('refuses an in-place upgrade when the live mapping change is not additive', async () => {
    const { builder, client, repository, state } = createDependencies();
    pinTopicsInPlace(state);
    const mappings = upgradableTopicsMappings();
    /** Elasticsearch cannot re-analyze an existing field, so a changed analyzer needs a rebuild. */
    mappings.properties.title = { analyzer: 'lobehub_icu', type: 'text' };
    vi.mocked(client.describeGenerations).mockResolvedValue([
      createLiveTopicsGeneration({ mappings }),
    ]);
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['topics'],
      entityConcurrency: 1,
    });

    const error = await service.run('test', 2, ['topics']).catch((cause) => cause);

    expect(error).toBeInstanceOf(FtsSearchReindexEntityError);
    expect(error).toMatchObject({ entity: 'topics' });
    expect(String((error as FtsSearchReindexEntityError).cause)).toContain(
      'The topics mapping change is not additive',
    );
    expect(client.putMapping).not.toHaveBeenCalled();
    expect(client.ensureIndex).not.toHaveBeenCalled();
  });

  it('refuses an in-place upgrade of an index the alias does not serve for writes', async () => {
    const { builder, client, repository, state } = createDependencies();
    pinTopicsInPlace(state);
    vi.mocked(client.describeGenerations).mockResolvedValue([
      createLiveTopicsGeneration({ isWriteIndex: false }),
    ]);
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['topics'],
      entityConcurrency: 1,
    });

    await expect(service.prepareIndices(state)).rejects.toMatchObject({
      entity: 'topics',
      message: expect.stringContaining('Elasticsearch alias test-topics does not serve'),
    });
    expect(client.putMapping).not.toHaveBeenCalled();
  });

  it('refuses an in-place upgrade of an index that is not an open generation', async () => {
    const { builder, client, repository, state } = createDependencies();
    pinTopicsInPlace(state);
    vi.mocked(client.describeGenerations).mockResolvedValue([
      createGeneration('test-topics-v2', { mappings: upgradableTopicsMappings(), version: 2 }),
    ]);
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['topics'],
      entityConcurrency: 1,
    });

    await expect(service.prepareIndices(state)).rejects.toMatchObject({
      entity: 'topics',
      message: expect.stringContaining(
        'Elasticsearch index test-topics-v1 is not an open generation of test-topics',
      ),
    });
    expect(client.putMapping).not.toHaveBeenCalled();
  });

  it('does not restamp an in-place upgrade the checkpoint already completed', async () => {
    const { builder, client, repository, state } = createDependencies();
    const topics = pinTopicsInPlace(state);
    topics.completedAt = '2026-08-28T00:01:00.000Z';
    topics.status = 'completed';
    const service = new FtsSearchReindexService(builder, repository, client, {
      entities: ['topics'],
      entityConcurrency: 1,
    });

    await service.prepareIndices(state);

    expect(client.describeGenerations).not.toHaveBeenCalled();
    expect(client.putMapping).not.toHaveBeenCalled();
    expect(client.ensureIndex).toHaveBeenCalledWith('test-topics-v1', expect.any(Object), {
      createIfMissing: false,
    });
  });

  it('accepts documents incremental sync wrote into an aliased generation', async () => {
    const { builder, client, repository } = createDependencies();
    const events: FtsSearchReindexProgressEvent[] = [];
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-agents-') ? 1 : 0,
    );
    vi.mocked(client.describeGenerations).mockImplementation(async (alias) => [
      createGeneration(`${alias}-v1`),
    ]);
    const service = new FtsSearchReindexService(builder, repository, client, {
      onProgress: (event) => {
        events.push(event);
      },
    });

    await expect(service.run('test', 1)).resolves.toMatchObject({
      status: 'ready_for_incremental_sync',
    });

    expect(events).toContainEqual({
      checkpointCount: 0,
      drift: 1,
      elasticsearchCount: 1,
      entity: 'agents',
      type: 'reconciliation',
    });
  });

  it('still blocks a shortfall while incremental sync writes to the generation', async () => {
    const { builder, client, repository, state } = createDependencies();
    state.progress.find(({ entity }) => entity === 'agents')!.indexedCount = 2;
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-agents-') ? 1 : 0,
    );
    vi.mocked(client.describeGenerations).mockImplementation(async (alias) => [
      createGeneration(`${alias}-v1`),
    ]);
    const service = new FtsSearchReindexService(builder, repository, client);

    await expect(service.run('test', 1)).rejects.toThrow(
      'Reindex count mismatch for agents: checkpoint=2, Elasticsearch=1',
    );

    expect(client.ensureAlias).not.toHaveBeenCalled();
  });

  it('blocks any drift on a fresh install whose generation no alias serves yet', async () => {
    const { builder, client, repository } = createDependencies();
    vi.mocked(client.count).mockImplementation(async (index) =>
      index.includes('-agents-') ? 1 : 0,
    );
    vi.mocked(client.describeGenerations).mockImplementation(async (alias) => [
      createGeneration(`${alias}-v1`, { aliased: false, isWriteIndex: false }),
    ]);
    const service = new FtsSearchReindexService(builder, repository, client);

    await expect(service.run('test', 1)).rejects.toThrow(
      'Reindex count mismatch for agents: checkpoint=0, Elasticsearch=1',
    );

    expect(client.ensureAlias).not.toHaveBeenCalled();
  });
});
