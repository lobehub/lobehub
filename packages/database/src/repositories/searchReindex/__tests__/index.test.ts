// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  searchReindexEntityProgress,
  searchReindexFailures,
  searchReindexRuns,
} from '../../../schemas';
import { SearchReindexRepository } from '..';

const db = await getTestDB();
const repository = new SearchReindexRepository(db);

const clean = async () => {
  await db.delete(searchReindexRuns);
};

beforeEach(clean);
afterAll(clean);

describe('SearchReindexRepository', () => {
  it('creates one durable v1 run and resumes it', async () => {
    const first = await repository.createOrResume('test-search', 1);
    const resumed = await repository.createOrResume('test-search', 1);

    expect(first.run.baseRevision).toBeGreaterThan(0);
    expect(first.progress).toHaveLength(14);
    expect(first.progress.map(({ physicalIndex }) => physicalIndex)).toContain(
      'test-search-messages-v1',
    );
    expect(resumed.run.id).toBe(first.run.id);
  });

  it('checkpoints item failures and resolves them before completing an entity', async () => {
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

    const [progress] = await db
      .select()
      .from(searchReindexEntityProgress)
      .where(
        and(
          eq(searchReindexEntityProgress.runId, state.run.id),
          eq(searchReindexEntityProgress.entity, 'agents'),
        ),
      );
    expect(progress).toMatchObject({ cursor: 'agent-2', failedCount: 1 });
    await expect(repository.completeEntity(state.run.id, 'agents')).rejects.toThrow(
      '1 reindex failures remain',
    );

    await expect(repository.resolveFailures(state.run.id, 'agents', ['agent-2'])).resolves.toBe(1);
    await repository.completeEntity(state.run.id, 'agents');

    const [completed] = await db
      .select()
      .from(searchReindexEntityProgress)
      .where(
        and(
          eq(searchReindexEntityProgress.runId, state.run.id),
          eq(searchReindexEntityProgress.entity, 'agents'),
        ),
      );
    const [failure] = await db
      .select()
      .from(searchReindexFailures)
      .where(eq(searchReindexFailures.runId, state.run.id));
    expect(completed).toMatchObject({ failedCount: 0, indexedCount: 2, status: 'completed' });
    expect(failure.resolvedAt).toBeInstanceOf(Date);
    await expect(
      db.select().from(searchReindexFailures).where(eq(searchReindexFailures.runId, state.run.id)),
    ).resolves.toHaveLength(1);
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

    const [progress] = await db
      .select()
      .from(searchReindexEntityProgress)
      .where(
        and(
          eq(searchReindexEntityProgress.runId, state.run.id),
          eq(searchReindexEntityProgress.entity, 'agents'),
        ),
      );
    const [failure] = await db
      .select()
      .from(searchReindexFailures)
      .where(eq(searchReindexFailures.runId, state.run.id));
    expect(progress).toMatchObject({ failedCount: 0, indexedCount: 0, processedCount: 1 });
    expect(failure.error).toMatch(/^Skipped by operator:/);
    expect(failure.resolvedAt).toBeInstanceOf(Date);
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
    await db
      .update(searchReindexEntityProgress)
      .set({ status: 'completed' })
      .where(eq(searchReindexEntityProgress.runId, state.run.id));

    await repository.markReadyForIncrementalSync(state.run.id);

    const ready = await repository.getRun(state.run.id);
    expect(ready?.run).toMatchObject({
      backfillHighWaterRevision: expect.any(Number),
      status: 'ready_for_incremental_sync',
    });
    expect(ready!.run.backfillHighWaterRevision).toBeGreaterThanOrEqual(state.run.baseRevision);
  });
});
