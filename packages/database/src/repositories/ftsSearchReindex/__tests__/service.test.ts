import type { FtsSearchDocumentEntity } from '@lobechat/types';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FtsSearchReindexRunState } from '..';
import type {
  FtsSearchReindexElasticsearchClient,
  FtsSearchReindexProgressEvent,
  FtsSearchReindexStateRepository,
} from '../service';
import { FtsSearchReindexService } from '../service';

const createState = (): FtsSearchReindexRunState => ({
  progress: FTS_SEARCH_DOCUMENT_ENTITIES.map((entity) => ({
    completedAt: null,
    cursor: null,
    entity,
    failedCount: 0,
    indexedCount: 0,
    physicalIndex: `test-${entity}-v1`,
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

const createDependencies = () => {
  const state = createState();
  const failures = new Map<FtsSearchDocumentEntity, { documentId: string }[]>();
  const builder = {
    buildBatch: vi.fn().mockResolvedValue([]),
    buildByIds: vi.fn().mockResolvedValue([]),
  };
  const client: FtsSearchReindexElasticsearchClient = {
    bulk: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    ensureAlias: vi.fn().mockResolvedValue(undefined),
    ensureIndex: vi.fn().mockResolvedValue(undefined),
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

beforeEach(() => vi.clearAllMocks());

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

  it('creates aliases only after all 14 entities complete', async () => {
    const { builder, client, repository, state } = createDependencies();
    const events: unknown[] = [];
    const lifecycle: string[] = [];
    const validateIncrementalSyncSource = vi.fn(async () => {
      lifecycle.push('validate-incremental-sync-source');
    });
    vi.mocked(client.ensureAlias).mockImplementation(async () => {
      lifecycle.push('create-alias');
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
          _meta: { reindex_run_id: 'run-1', schema_version: 1 },
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
      { buildBatch: vi.fn().mockResolvedValue([]), buildByIds: vi.fn().mockResolvedValue([]) },
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
});
