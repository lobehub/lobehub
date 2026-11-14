import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalTestCases,
  users,
} from '../../../schemas';
import { AgentEvalRunModel } from '../run';

const serverDB = await getTestDB();

const userId = 'run-test-user';
const userId2 = 'run-test-user-2';
const runModel = new AgentEvalRunModel(serverDB, userId);

let benchmarkId: string;
let datasetId: string;

beforeEach(async () => {
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);

  // Create a test benchmark
  const [benchmark] = await serverDB
    .insert(agentEvalBenchmarks)
    .values({
      identifier: 'test-benchmark',
      name: 'Test Benchmark',
      rubrics: [],
      isSystem: false,
    })
    .returning();
  benchmarkId = benchmark.id;

  // Create a test dataset
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId,
      identifier: 'test-dataset',
      name: 'Test Dataset',
      userId,
    })
    .returning();
  datasetId = dataset.id;
});

afterEach(async () => {
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);
});

describe('AgentEvalRunModel', () => {
  describe('count', () => {
    beforeEach(async () => {
      await serverDB.insert(agentEvalRuns).values([
        { datasetId, status: 'completed', userId },
        { datasetId, status: 'running', userId },
        // Another user's run must never be counted
        { datasetId, status: 'completed', userId: userId2 },
      ]);
    });

    it('should count only runs owned by the user', async () => {
      expect(await runModel.count()).toBe(2);
    });

    it('should apply status and datasetId filters', async () => {
      expect(await runModel.count({ status: 'completed' })).toBe(1);
      expect(await runModel.count({ datasetId })).toBe(2);
      expect(await runModel.count({ datasetId: 'nonexistent' })).toBe(0);
    });
  });

  describe('create', () => {
    it('should create a new run with minimal parameters', async () => {
      const params = {
        datasetId,
      };

      const result = await runModel.create(params);

      expect(result).toBeDefined();
      expect(result.datasetId).toBe(datasetId);
      expect(result.userId).toBe(userId);
      expect(result.status).toBe('idle');
      expect(result.name).toBeNull();
      expect(result.targetAgentId).toBeNull();
      expect(result.config).toBeNull();
      expect(result.metrics).toBeNull();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a run with all parameters', async () => {
      const params = {
        datasetId,
        name: 'Test Run',
        status: 'pending' as const,
        config: {
          concurrency: 5,
          timeout: 300000,
        },
        metrics: {
          totalCases: 10,
          passedCases: 0,
          failedCases: 0,
          averageScore: 0,
          passRate: 0,
        },
      };

      const result = await runModel.create(params);

      expect(result).toBeDefined();
      expect(result.datasetId).toBe(datasetId);
      expect(result.name).toBe('Test Run');
      expect(result.status).toBe('pending');
      expect(result.config).toEqual({ concurrency: 5, timeout: 300000 });
      expect(result.metrics).toMatchObject({
        totalCases: 10,
        passedCases: 0,
        failedCases: 0,
        averageScore: 0,
        passRate: 0,
      });
    });
  });

  it('does not finalize over Stop, while allowing an explicit resume', async () => {
    const run = await runModel.create({ datasetId, status: 'running' });
    await runModel.update(run.id, { status: 'aborted' });
    expect(await runModel.finalize(run.id, { status: 'completed' })).toBeUndefined();
    expect((await runModel.findById(run.id))?.status).toBe('aborted');
    await runModel.update(run.id, { status: 'running' });
    expect(await runModel.finalize(run.id, { status: 'completed' })).toMatchObject({
      status: 'completed',
    });
  });

  it('keeps live progress from overwriting the metrics of a finalized run', async () => {
    const run = await runModel.create({ datasetId, status: 'running' });
    await runModel.updateProgress(run.id, {
      failedCases: 1,
      passedCases: 0,
      totalCases: 2,
    } as never);
    expect((await runModel.findById(run.id))?.metrics).toMatchObject({ failedCases: 1 });
    await runModel.finalize(run.id, {
      metrics: { failedCases: 1, passedCases: 1, totalCases: 2 } as never,
      status: 'completed',
    });
    // A progress write computed before finalization arrives late.
    expect(
      await runModel.updateProgress(run.id, {
        failedCases: 1,
        passedCases: 0,
        totalCases: 2,
      } as never),
    ).toBeUndefined();
    expect((await runModel.findById(run.id))?.metrics).toMatchObject({ passedCases: 1 });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Create another dataset
      const [dataset2] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'dataset-2',
          name: 'Dataset 2',
          userId,
        })
        .returning();

      // Insert runs
      await serverDB
        .insert(agentEvalRuns)
        .values([
          {
            datasetId,
            userId,
            name: 'Run 1',
            status: 'idle',
          },
          {
            datasetId,
            userId,
            name: 'Run 2',
            status: 'pending',
          },
          {
            datasetId: dataset2.id,
            userId,
            name: 'Run 3',
            status: 'running',
          },
          {
            datasetId,
            userId: userId2,
            name: 'Run 4 - Other User',
            status: 'completed',
          },
        ])
        .returning();
    });

    it('should query all runs for the user', async () => {
      const results = await runModel.query();

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.name)).toContain('Run 1');
      expect(results.map((r) => r.name)).toContain('Run 2');
      expect(results.map((r) => r.name)).toContain('Run 3');
    });

    it('should filter by datasetId', async () => {
      const results = await runModel.query({ datasetId });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.datasetId === datasetId)).toBe(true);
    });

    it('should filter by status', async () => {
      const results = await runModel.query({ status: 'pending' });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Run 2');
      expect(results[0].status).toBe('pending');
    });

    it('should filter by benchmarkId', async () => {
      // The query beforeEach created dataset2 under the same benchmark, so
      // all 3 user runs belong to datasets of `benchmarkId`.
      const results = await runModel.query({ benchmarkId });

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.name)).toContain('Run 1');
      expect(results.map((r) => r.name)).toContain('Run 2');
      expect(results.map((r) => r.name)).toContain('Run 3');
    });

    it('should return empty when benchmarkId has no datasets', async () => {
      const [otherBenchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'other-benchmark',
          name: 'Other Benchmark',
          rubrics: [],
          isSystem: false,
        })
        .returning();

      const results = await runModel.query({ benchmarkId: otherBenchmark.id });

      expect(results).toHaveLength(0);
    });

    it('should filter by benchmarkId and status', async () => {
      const results = await runModel.query({ benchmarkId, status: 'pending' });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Run 2');
    });

    it('should filter by datasetId and status', async () => {
      const results = await runModel.query({
        datasetId,
        status: 'idle',
      });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Run 1');
    });

    it('should apply limit', async () => {
      const results = await runModel.query({ limit: 2 });

      expect(results).toHaveLength(2);
    });

    it('should apply offset', async () => {
      const allResults = await runModel.query();
      const offsetResults = await runModel.query({ offset: 1 });

      expect(offsetResults).toHaveLength(2);
      expect(offsetResults[0].id).toBe(allResults[1].id);
    });
  });

  describe('findById', () => {
    it('should find a run by id', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId,
          name: 'Find Test',
          status: 'idle',
        })
        .returning();

      const result = await runModel.findById(run.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(run.id);
      expect(result?.name).toBe('Find Test');
    });

    it('should not find a run owned by another user', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId: userId2,
          name: 'Other User Run',
          status: 'idle',
        })
        .returning();

      const result = await runModel.findById(run.id);

      expect(result).toBeUndefined();
    });

    it('should return undefined when run not found', async () => {
      const result = await runModel.findById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a run owned by the user', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId,
          name: 'Original Name',
          status: 'idle',
        })
        .returning();

      const result = await runModel.update(run.id, {
        name: 'Updated Name',
        status: 'running',
        metrics: {
          totalCases: 10,
          passedCases: 5,
          failedCases: 0,
          averageScore: 0.85,
          passRate: 0.5,
        },
      });

      expect(result).toBeDefined();
      expect(result?.name).toBe('Updated Name');
      expect(result?.status).toBe('running');
      expect(result?.metrics).toMatchObject({
        totalCases: 10,
        passedCases: 5,
        failedCases: 0,
        averageScore: 0.85,
        passRate: 0.5,
      });
      expect(result?.updatedAt).toBeDefined();
    });

    it('should not update a run owned by another user', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId: userId2,
          name: 'Other User Run',
          status: 'idle',
        })
        .returning();

      const result = await runModel.update(run.id, {
        name: 'Attempted Update',
      });

      expect(result).toBeUndefined();

      const unchanged = await serverDB.query.agentEvalRuns.findFirst({
        where: eq(agentEvalRuns.id, run.id),
      });
      expect(unchanged?.name).toBe('Other User Run');
    });

    it('should return undefined when run not found', async () => {
      const result = await runModel.update('non-existent-id', {
        name: 'New Name',
      });

      expect(result).toBeUndefined();
    });

    it('should update only specified fields', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId,
          name: 'Original',
          status: 'idle',
        })
        .returning();

      const result = await runModel.update(run.id, {
        status: 'pending',
      });

      expect(result?.name).toBe('Original');
      expect(result?.status).toBe('pending');
    });

    it('should update config', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId,
          status: 'idle',
        })
        .returning();

      const result = await runModel.update(run.id, {
        config: { concurrency: 10, timeout: 600000 },
      });

      expect(result?.config).toEqual({ concurrency: 10, timeout: 600000 });
    });

    it('should update metrics incrementally', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId,
          status: 'running',
          metrics: {
            totalCases: 10,
            passedCases: 0,
            failedCases: 0,
            averageScore: 0,
            passRate: 0,
          },
        })
        .returning();

      const result = await runModel.update(run.id, {
        metrics: {
          totalCases: 10,
          passedCases: 5,
          failedCases: 1,
          averageScore: 0.75,
          passRate: 0.5,
        },
      });

      expect(result?.metrics).toMatchObject({
        totalCases: 10,
        passedCases: 5,
        failedCases: 1,
        averageScore: 0.75,
        passRate: 0.5,
      });
    });
  });

  describe('delete', () => {
    it('should delete a run owned by the user', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId,
          name: 'Delete Test',
          status: 'idle',
        })
        .returning();

      await runModel.delete(run.id);

      const deleted = await serverDB.query.agentEvalRuns.findFirst({
        where: eq(agentEvalRuns.id, run.id),
      });
      expect(deleted).toBeUndefined();
    });

    it('should not delete a run owned by another user', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId: userId2,
          name: 'Other User Run',
          status: 'idle',
        })
        .returning();

      await runModel.delete(run.id);

      const stillExists = await serverDB.query.agentEvalRuns.findFirst({
        where: eq(agentEvalRuns.id, run.id),
      });
      expect(stillExists).toBeDefined();
    });
  });

  describe('queue', () => {
    it('atomically transitions an idle run only once', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId, userId, status: 'idle' })
        .returning();

      expect((await runModel.queue(run.id))?.status).toBe('pending');
      expect(await runModel.queue(run.id)).toBeUndefined();
    });

    it('does not queue another user’s run', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId, userId: userId2, status: 'idle' })
        .returning();

      expect(await runModel.queue(run.id)).toBeUndefined();
    });
  });

  describe('claim', () => {
    it('should transition a pending run to running and set startedAt', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId, userId, status: 'pending' })
        .returning();

      const result = await runModel.claim(run.id);

      expect(result).toBeDefined();
      expect(result?.status).toBe('running');
      expect(result?.startedAt).toBeDefined();
    });

    it('should return undefined for a non-pending run (double claim)', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId, userId, status: 'pending' })
        .returning();

      const first = await runModel.claim(run.id);
      expect(first?.status).toBe('running');

      const second = await runModel.claim(run.id);
      expect(second).toBeUndefined();
    });

    it('should not claim a run owned by another user', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId, userId: userId2, status: 'pending' })
        .returning();

      const result = await runModel.claim(run.id);
      expect(result).toBeUndefined();

      const unchanged = await serverDB.query.agentEvalRuns.findFirst({
        where: eq(agentEvalRuns.id, run.id),
      });
      expect(unchanged?.status).toBe('pending');
    });

    it('should not claim an idle run', async () => {
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId, userId, status: 'idle' })
        .returning();

      const result = await runModel.claim(run.id);
      expect(result).toBeUndefined();
    });
  });

  describe('countByDatasetId', () => {
    beforeEach(async () => {
      // Create another dataset
      const [dataset2] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'dataset-2',
          name: 'Dataset 2',
          userId,
        })
        .returning();

      // Insert runs
      await serverDB.insert(agentEvalRuns).values([
        {
          datasetId,
          userId,
          status: 'idle',
        },
        {
          datasetId,
          userId,
          status: 'pending',
        },
        {
          datasetId: dataset2.id,
          userId,
          status: 'running',
        },
        {
          datasetId,
          userId: userId2, // Other user's run
          status: 'completed',
        },
      ]);
    });

    it('should count runs for a specific dataset and user', async () => {
      const count = await runModel.countByDatasetId(datasetId);

      expect(count).toBe(2); // Only user's runs
    });

    it('should return 0 when no runs exist', async () => {
      const [emptyDataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'empty-dataset',
          name: 'Empty Dataset',
          userId,
        })
        .returning();

      const count = await runModel.countByDatasetId(emptyDataset.id);

      expect(count).toBe(0);
    });
  });

  describe('startedAt guards', () => {
    const startedAt = new Date('2026-10-01T00:00:00.000Z');

    it('applies update only to the run whose start timestamp still matches', async () => {
      const run = await runModel.create({ datasetId, startedAt, status: 'running' });

      expect(await runModel.update(run.id, { name: 'Guarded' }, { startedAt })).toMatchObject({
        name: 'Guarded',
      });
      // A caller that read an older start timestamp must not overwrite the new attempt.
      expect(
        await runModel.update(run.id, { name: 'Stale' }, { startedAt: new Date(0) }),
      ).toBeUndefined();
      expect((await runModel.findById(run.id))?.name).toBe('Guarded');
    });

    it('treats a null start timestamp as its own attempt', async () => {
      const run = await runModel.create({ datasetId, status: 'running' });

      expect(
        await runModel.update(run.id, { name: 'Unstarted' }, { startedAt: null }),
      ).toMatchObject({ name: 'Unstarted' });
      expect(await runModel.update(run.id, { name: 'Wrong' }, { startedAt })).toBeUndefined();
    });

    it('writes progress only for the matching attempt of a live run', async () => {
      const run = await runModel.create({ datasetId, startedAt, status: 'running' });

      expect(
        await runModel.updateProgress(run.id, { passedCases: 3 }, { startedAt }),
      ).toMatchObject({ metrics: expect.objectContaining({ passedCases: 3 }) });
      expect(
        await runModel.updateProgress(run.id, { passedCases: 9 }, { startedAt: null }),
      ).toBeUndefined();

      const unstarted = await runModel.create({ datasetId, status: 'running' });
      expect(
        await runModel.updateProgress(unstarted.id, { passedCases: 1 }, { startedAt: null }),
      ).toMatchObject({ metrics: expect.objectContaining({ passedCases: 1 }) });
    });

    it('finalizes only the matching attempt', async () => {
      const run = await runModel.create({ datasetId, startedAt, status: 'running' });

      expect(
        await runModel.finalize(
          run.id,
          { metrics: { passedCases: 1 }, status: 'completed' },
          { startedAt: startedAt.toISOString() },
        ),
      ).toMatchObject({ status: 'completed' });
      expect(
        await runModel.finalize(run.id, { status: 'failed' }, { startedAt: new Date(0) }),
      ).toBeUndefined();
      expect((await runModel.findById(run.id))?.status).toBe('completed');

      const unstarted = await runModel.create({ datasetId, status: 'running' });
      expect(
        await runModel.finalize(unstarted.id, { status: 'completed' }, { startedAt: null }),
      ).toMatchObject({ status: 'completed' });
    });
  });
});
