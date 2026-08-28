import type { SearchDocumentEntity } from '@lobechat/types';
import { SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchReindexRunState } from '..';
import type { SearchReindexElasticsearchClient, SearchReindexStateRepository } from '../service';
import { SearchReindexService } from '../service';

const createState = (): SearchReindexRunState => ({
  progress: SEARCH_DOCUMENT_ENTITIES.map((entity) => ({
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
    baseRevision: 10,
    backfillHighWaterRevision: null,
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
  const failures = new Map<SearchDocumentEntity, { documentId: string }[]>();
  const builder = {
    buildBatch: vi.fn().mockResolvedValue([]),
    buildByIds: vi.fn().mockResolvedValue([]),
  };
  const client: SearchReindexElasticsearchClient = {
    bulk: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    ensureAlias: vi.fn().mockResolvedValue(undefined),
    ensureIndex: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const repository: SearchReindexStateRepository = {
    checkpointBatch: vi.fn(async (checkpoint) => {
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
    }),
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

describe('SearchReindexService', () => {
  it('creates aliases only after all 14 entities complete', async () => {
    const { builder, client, repository, state } = createDependencies();
    const service = new SearchReindexService(builder, repository, client);

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
    );
    expect(client.ensureAlias).toHaveBeenCalledTimes(14);
    expect(repository.markReadyForIncrementalSync).toHaveBeenCalledOnce();
    expect(state.progress.every(({ status }) => status === 'completed')).toBe(true);
  });

  it('does not advance the cursor or create aliases after a request-level bulk failure', async () => {
    const { builder, client, repository, state } = createDependencies();
    builder.buildBatch
      .mockResolvedValueOnce([{ entity: 'agents', id: 'agent-1', source: { id: 'agent-1' } }])
      .mockResolvedValue([]);
    vi.mocked(client.bulk).mockRejectedValueOnce(new Error('gateway unavailable'));
    const service = new SearchReindexService(builder, repository, client);

    await expect(service.run('test', 1)).rejects.toThrow('gateway unavailable');

    expect(repository.checkpointBatch).not.toHaveBeenCalled();
    expect(client.ensureAlias).not.toHaveBeenCalled();
    expect(state.progress[0].cursor).toBeNull();
  });

  it('persists an oversized item and blocks alias creation', async () => {
    const { builder, client, repository } = createDependencies();
    builder.buildBatch
      .mockResolvedValueOnce([
        { entity: 'agents', id: 'agent-large', source: { id: 'agent-large', title: 'large' } },
      ])
      .mockResolvedValue([]);
    const service = new SearchReindexService(builder, repository, client, { bulkMaxBytes: 1 });

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
    const service = new SearchReindexService(builder, repository, client);

    await expect(service.run('test', 1)).resolves.toMatchObject({
      status: 'ready_for_incremental_sync',
    });
    expect(repository.checkpointBatch).toHaveBeenCalledWith(
      expect.objectContaining({ failures: [], indexedCount: 1 }),
    );
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
    const service = new SearchReindexService(builder, repository, client);

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
