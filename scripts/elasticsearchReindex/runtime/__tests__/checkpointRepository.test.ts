// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FtsSearchReindexFileRepository } from '../checkpointRepository';

let stateDirectory: string;
let repository: FtsSearchReindexFileRepository;
let captureFingerprint = 'capture-v1';
let revision = 10;

beforeEach(async () => {
  stateDirectory = await mkdtemp(path.join(tmpdir(), 'search-reindex-test-'));
  captureFingerprint = 'capture-v1';
  revision = 10;
  repository = new FtsSearchReindexFileRepository({
    readCaptureFingerprint: vi.fn(async () => captureFingerprint),
    readHighWaterRevision: vi.fn(async () => revision),
    reserveRevisionWithWriteFence: vi.fn(async () => ++revision),
    stateDirectory,
  });
});

afterEach(async () => {
  await rm(stateDirectory, { force: true, recursive: true });
});

describe('FtsSearchReindexFileRepository', () => {
  it('creates one local v2 checkpoint and resumes it after constructing a new repository', async () => {
    const first = await repository.createOrResume('test-search', 1);
    const resumed = await new FtsSearchReindexFileRepository({
      readCaptureFingerprint: vi.fn(async () => captureFingerprint),
      readHighWaterRevision: vi.fn(async () => revision),
      reserveRevisionWithWriteFence: vi.fn(async () => ++revision),
      stateDirectory,
    }).createOrResume('test-search', 1);

    expect(first.run.baseRevision).toBe(11);
    expect(first.progress).toHaveLength(14);
    expect(first.progress.map(({ physicalIndex }) => physicalIndex)).toContain(
      'test-search-messages-v1',
    );
    expect(resumed.run.id).toBe(first.run.id);
    expect(resumed.run.captureFingerprint).toBe(captureFingerprint);

    const checkpointFiles = await readdir(stateDirectory);
    expect(checkpointFiles).toHaveLength(1);
    expect(checkpointFiles[0]).toMatch(/^reindex-test-search-[a-f\d]{12}-v1\.json$/);
    const checkpoint = JSON.parse(
      await readFile(path.join(stateDirectory, checkpointFiles[0]), 'utf8'),
    );
    expect(checkpoint).toMatchObject({
      formatVersion: 2,
      run: { captureFingerprint, namespace: 'test-search' },
    });
  });

  it('refuses to resume a checkpoint when capture definitions changed', async () => {
    const state = await repository.createOrResume('changed-capture-search', 1);
    await repository.completeEntity(state.run.id, 'agents');
    captureFingerprint = 'capture-v2';

    const restarted = new FtsSearchReindexFileRepository({
      readCaptureFingerprint: vi.fn(async () => captureFingerprint),
      readHighWaterRevision: vi.fn(async () => revision),
      reserveRevisionWithWriteFence: vi.fn(async () => ++revision),
      stateDirectory,
    });

    await expect(restarted.createOrResume('changed-capture-search', 1)).rejects.toThrow(
      'capture definition fingerprint changed',
    );
    await expect(restarted.getTargetRun('changed-capture-search', 1)).resolves.toMatchObject({
      progress: expect.arrayContaining([
        expect.objectContaining({ entity: 'agents', status: 'completed' }),
      ]),
      run: { captureFingerprint: 'capture-v1' },
    });
  });

  it('reports a corrupt checkpoint instead of silently starting over', async () => {
    await repository.createOrResume('corrupt-search', 1);
    const [checkpointFile] = await readdir(stateDirectory);
    await writeFile(path.join(stateDirectory, checkpointFile), '{');

    await expect(repository.createOrResume('corrupt-search', 1)).rejects.toThrow(
      'FTS reindex checkpoint is not valid JSON',
    );
    await expect(readdir(stateDirectory)).resolves.toEqual([checkpointFile]);
  });

  it('loads the exact target without parsing an unrelated corrupt checkpoint', async () => {
    const state = await repository.createOrResume('healthy-search', 1);
    await writeFile(path.join(stateDirectory, 'reindex-unrelated-deadbeef-v1.json'), '{');

    const restarted = new FtsSearchReindexFileRepository({
      readCaptureFingerprint: vi.fn(async () => captureFingerprint),
      readHighWaterRevision: vi.fn(async () => revision),
      reserveRevisionWithWriteFence: vi.fn(async () => ++revision),
      stateDirectory,
    });
    await expect(restarted.getTargetRun('healthy-search', 1)).resolves.toMatchObject({
      run: { id: state.run.id },
    });
  });

  it('atomically checkpoints item failures and rejects a stale cursor', async () => {
    const state = await repository.createOrResume('checkpoint-search', 1);

    await expect(
      repository.checkpointBatch({
        cursor: 'agent-2',
        entity: 'agents',
        failures: [
          { documentId: 'agent-2', error: new Error('mapping rejected'), retryable: false },
        ],
        indexedCount: 1,
        previousCursor: null,
        processedCount: 2,
        runId: state.run.id,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.checkpointBatch({
        cursor: 'agent-2',
        entity: 'agents',
        failures: [{ documentId: 'agent-3', error: new Error('stale worker'), retryable: true }],
        indexedCount: 1,
        previousCursor: null,
        processedCount: 2,
        runId: state.run.id,
      }),
    ).resolves.toBe(false);

    const checkpointed = await repository.getRun(state.run.id);
    expect(checkpointed?.progress.find(({ entity }) => entity === 'agents')).toMatchObject({
      cursor: 'agent-2',
      failedCount: 1,
      indexedCount: 1,
      processedCount: 2,
    });
    await expect(repository.completeEntity(state.run.id, 'agents')).rejects.toThrow(
      '1 reindex failures remain',
    );

    await expect(repository.resolveFailures(state.run.id, 'agents', ['agent-2'])).resolves.toBe(1);
    await repository.completeEntity(state.run.id, 'agents');

    const completed = await repository.getRun(state.run.id);
    expect(completed?.progress.find(({ entity }) => entity === 'agents')).toMatchObject({
      failedCount: 0,
      indexedCount: 2,
      status: 'completed',
    });
    await expect(repository.listUnresolvedFailures(state.run.id)).resolves.toEqual([]);
  });

  it('refuses to mark a run ready while entities are incomplete', async () => {
    const state = await repository.createOrResume('not-ready-search', 1);

    await expect(repository.markReadyForIncrementalSync(state.run.id)).rejects.toThrow(
      'Cannot create aliases',
    );
  });

  it('lets an operator skip a failed document without counting it as indexed', async () => {
    const state = await repository.createOrResume('skip-failure-search', 1);
    await repository.checkpointBatch({
      cursor: 'agent-1',
      entity: 'agents',
      failures: [{ documentId: 'agent-1', error: new Error('mapping rejected'), retryable: false }],
      indexedCount: 0,
      previousCursor: null,
      processedCount: 1,
      runId: state.run.id,
    });

    await expect(repository.skipFailure(state.run.id, 'agents', 'agent-1')).resolves.toBe(true);
    await expect(repository.skipFailure(state.run.id, 'agents', 'agent-1')).resolves.toBe(false);

    const skipped = await repository.getRun(state.run.id);
    expect(skipped?.progress.find(({ entity }) => entity === 'agents')).toMatchObject({
      failedCount: 0,
      indexedCount: 0,
      processedCount: 1,
    });
    await expect(repository.listUnresolvedFailures(state.run.id)).resolves.toEqual([]);
  });

  it('does not let an operator skip an uncertain retryable failure', async () => {
    const state = await repository.createOrResume('retryable-failure-search', 1);
    await repository.checkpointBatch({
      cursor: 'agent-1',
      entity: 'agents',
      failures: [{ documentId: 'agent-1', error: new Error('gateway timeout'), retryable: true }],
      indexedCount: 0,
      previousCursor: null,
      processedCount: 1,
      runId: state.run.id,
    });

    await expect(repository.skipFailure(state.run.id, 'agents', 'agent-1')).resolves.toBe(false);
    await expect(repository.listUnresolvedFailures(state.run.id, 'agents')).resolves.toHaveLength(
      1,
    );
  });

  it('records the Outbox high-water boundary when all entities are ready', async () => {
    const state = await repository.createOrResume('ready-search', 1);
    for (const entity of FTS_SEARCH_DOCUMENT_ENTITIES) {
      await repository.completeEntity(state.run.id, entity);
    }

    await repository.markReadyForIncrementalSync(state.run.id);

    const ready = await repository.getRun(state.run.id);
    expect(ready?.run).toMatchObject({
      backfillHighWaterRevision: revision,
      status: 'ready_for_incremental_sync',
    });
    expect(ready!.run.backfillHighWaterRevision).toBeGreaterThanOrEqual(state.run.baseRevision);
  });
});
