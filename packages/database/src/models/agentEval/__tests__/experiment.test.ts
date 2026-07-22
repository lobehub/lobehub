import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalExperimentBenchmarks,
  agentEvalExperiments,
  agentEvalRuns,
  users,
} from '../../../schemas';
import { AgentEvalExperimentModel } from '../experiment';

const serverDB = await getTestDB();

const userId = 'experiment-test-user';
const userId2 = 'experiment-test-user-2';
const experimentModel = new AgentEvalExperimentModel(serverDB, userId);
const experimentModel2 = new AgentEvalExperimentModel(serverDB, userId2);

const createBenchmark = async (
  overrides: Partial<typeof agentEvalBenchmarks.$inferInsert> = {},
) => {
  const [benchmark] = await serverDB
    .insert(agentEvalBenchmarks)
    .values({
      identifier: `bench-${Math.random().toString(36).slice(2, 8)}`,
      isSystem: false,
      name: 'Benchmark',
      rubrics: [],
      userId,
      ...overrides,
    })
    .returning();
  return benchmark;
};

const createDataset = async (overrides: Partial<typeof agentEvalDatasets.$inferInsert> = {}) => {
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId: overrides.benchmarkId!,
      identifier: `ds-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Dataset',
      userId,
      ...overrides,
    })
    .returning();
  return dataset;
};

beforeEach(async () => {
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalExperimentBenchmarks);
  await serverDB.delete(agentEvalExperiments);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalExperimentBenchmarks);
  await serverDB.delete(agentEvalExperiments);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);
});

describe('AgentEvalExperimentModel', () => {
  describe('create', () => {
    it('should create an experiment with benchmark junction rows', async () => {
      const bench1 = await createBenchmark();
      const bench2 = await createBenchmark();

      const result = await experimentModel.create({
        benchmarkIds: [bench1.id, bench2.id],
        name: 'My Experiment',
      });

      expect(result.id).toBeDefined();
      expect(result.userId).toBe(userId);

      const junctions = await serverDB.query.agentEvalExperimentBenchmarks.findMany({
        where: eq(agentEvalExperimentBenchmarks.experimentId, result.id),
      });
      expect(junctions).toHaveLength(2);
    });

    it('should dedupe benchmark ids', async () => {
      const bench1 = await createBenchmark();

      const result = await experimentModel.create({
        benchmarkIds: [bench1.id, bench1.id],
        name: 'Deduped',
      });

      const junctions = await serverDB.query.agentEvalExperimentBenchmarks.findMany({
        where: eq(agentEvalExperimentBenchmarks.experimentId, result.id),
      });
      expect(junctions).toHaveLength(1);
    });

    it('should create with a caller-supplied id', async () => {
      const bench1 = await createBenchmark();

      const result = await experimentModel.create({
        benchmarkIds: [bench1.id],
        id: 'exp_custom_id',
        name: 'Custom ID',
      });

      expect(result.id).toBe('exp_custom_id');
    });

    it('should be idempotent: creating twice with the same id returns the existing experiment', async () => {
      const bench1 = await createBenchmark();

      const first = await experimentModel.create({
        benchmarkIds: [bench1.id],
        id: 'exp_idempotent',
        name: 'First',
      });
      const second = await experimentModel.create({
        benchmarkIds: [bench1.id],
        id: 'exp_idempotent',
        name: 'Second (ignored)',
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('First');

      // No duplicate junction rows
      const junctions = await serverDB.query.agentEvalExperimentBenchmarks.findMany({
        where: eq(agentEvalExperimentBenchmarks.experimentId, first.id),
      });
      expect(junctions).toHaveLength(1);
    });

    it('should reject an inaccessible benchmark id without creating anything', async () => {
      const otherBench = await createBenchmark({ userId: userId2 });

      await expect(
        experimentModel.create({ benchmarkIds: [otherBench.id], name: 'Nope' }),
      ).rejects.toThrow('Benchmarks not found or inaccessible');

      const all = await serverDB.query.agentEvalExperiments.findMany();
      expect(all).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('should return the single payload with benchmarks, datasets and runs', async () => {
      const bench = await createBenchmark();
      const baseline = await createDataset({ benchmarkId: bench.id });
      const experiment = await experimentModel.create({
        benchmarkIds: [bench.id],
        name: 'Detail',
      });
      const scoped = await createDataset({
        benchmarkId: bench.id,
        sourceExperimentId: experiment.id,
      });
      await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId: scoped.id, experimentId: experiment.id, status: 'idle', userId });

      const detail = await experimentModel.findById(experiment.id);

      expect(detail).toBeDefined();
      expect(detail!.benchmarks.map((b) => b.id)).toEqual([bench.id]);
      // Both baseline and scoped datasets come back in one payload
      const datasetIds = detail!.datasets.map((d) => d.id);
      expect(datasetIds).toContain(baseline.id);
      expect(datasetIds).toContain(scoped.id);
      expect(detail!.runs).toHaveLength(1);
      expect(detail!.runs[0].experimentId).toBe(experiment.id);
    });

    it("should not find another user's experiment", async () => {
      const bench = await createBenchmark();
      const experiment = await experimentModel.create({ benchmarkIds: [bench.id], name: 'Mine' });

      const result = await experimentModel2.findById(experiment.id);
      expect(result).toBeUndefined();
    });

    it('should return undefined when not found', async () => {
      expect(await experimentModel.findById('non-existent')).toBeUndefined();
    });
  });

  describe('query', () => {
    it('should return aggregate counts and a recent-runs preview', async () => {
      const bench = await createBenchmark();
      const experiment = await experimentModel.create({
        benchmarkIds: [bench.id],
        name: 'Agg',
      });
      const scoped = await createDataset({
        benchmarkId: bench.id,
        sourceExperimentId: experiment.id,
      });
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId: scoped.id, experimentId: experiment.id, status: 'idle', userId })
        .returning();

      const results = await experimentModel.query();
      const row = results.find((r) => r.id === experiment.id)!;

      expect(row.benchmarkCount).toBe(1);
      expect(row.datasetCount).toBe(1);
      expect(row.runCount).toBe(1);
      expect(row.benchmarks.map((b) => b.id)).toEqual([bench.id]);

      // recent runs preview (batched, no N+1) with dataset + benchmark context
      expect(row.recentRuns).toHaveLength(1);
      expect(row.recentRuns![0].id).toBe(run.id);
      expect(row.recentRuns![0].datasetName).toBe(scoped.name);
      expect(row.recentRuns![0].benchmarkId).toBe(bench.id);
    });

    it('should cap recent runs at 5 per experiment without N+1', async () => {
      const bench = await createBenchmark();
      const experiment = await experimentModel.create({
        benchmarkIds: [bench.id],
        name: 'Capped',
      });
      const scoped = await createDataset({
        benchmarkId: bench.id,
        sourceExperimentId: experiment.id,
      });
      await serverDB.insert(agentEvalRuns).values(
        Array.from({ length: 8 }, (_, i) => ({
          datasetId: scoped.id,
          experimentId: experiment.id,
          name: `Run ${i}`,
          status: 'idle' as const,
          userId,
        })),
      );

      const results = await experimentModel.query();
      const row = results.find((r) => r.id === experiment.id)!;

      expect(row.runCount).toBe(8);
      expect(row.recentRuns).toHaveLength(5);
    });

    it("should not return another user's experiments", async () => {
      const bench = await createBenchmark();
      await experimentModel.create({ benchmarkIds: [bench.id], name: 'Mine' });

      const results = await experimentModel2.query();
      expect(results).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update fields and replace benchmark junctions', async () => {
      const bench1 = await createBenchmark();
      const bench2 = await createBenchmark();
      const experiment = await experimentModel.create({
        benchmarkIds: [bench1.id],
        name: 'Original',
      });

      const updated = await experimentModel.update(experiment.id, {
        benchmarkIds: [bench2.id],
        name: 'Updated',
      });

      expect(updated?.name).toBe('Updated');
      const junctions = await serverDB.query.agentEvalExperimentBenchmarks.findMany({
        where: eq(agentEvalExperimentBenchmarks.experimentId, experiment.id),
      });
      expect(junctions.map((j) => j.benchmarkId)).toEqual([bench2.id]);
    });

    it('should reject invalid benchmark ids and preserve existing junctions', async () => {
      const bench1 = await createBenchmark();
      const otherBench = await createBenchmark({ userId: userId2 });
      const experiment = await experimentModel.create({
        benchmarkIds: [bench1.id],
        name: 'Keep',
      });

      await expect(
        experimentModel.update(experiment.id, { benchmarkIds: [otherBench.id] }),
      ).rejects.toThrow('Benchmarks not found or inaccessible');

      const junctions = await serverDB.query.agentEvalExperimentBenchmarks.findMany({
        where: eq(agentEvalExperimentBenchmarks.experimentId, experiment.id),
      });
      expect(junctions.map((j) => j.benchmarkId)).toEqual([bench1.id]);
    });
  });

  describe('delete', () => {
    it('should detach runs and datasets before deleting the experiment', async () => {
      const bench = await createBenchmark();
      const experiment = await experimentModel.create({
        benchmarkIds: [bench.id],
        name: 'ToDelete',
      });
      const scoped = await createDataset({
        benchmarkId: bench.id,
        sourceExperimentId: experiment.id,
      });
      const [run] = await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId: scoped.id, experimentId: experiment.id, status: 'idle', userId })
        .returning();

      await experimentModel.delete(experiment.id);

      // Experiment + junctions gone
      expect(
        await serverDB.query.agentEvalExperiments.findFirst({
          where: eq(agentEvalExperiments.id, experiment.id),
        }),
      ).toBeUndefined();
      expect(
        await serverDB.query.agentEvalExperimentBenchmarks.findMany({
          where: eq(agentEvalExperimentBenchmarks.experimentId, experiment.id),
        }),
      ).toHaveLength(0);

      // Run + dataset preserved but detached
      const runAfter = await serverDB.query.agentEvalRuns.findFirst({
        where: eq(agentEvalRuns.id, run.id),
      });
      expect(runAfter).toBeDefined();
      expect(runAfter!.experimentId).toBeNull();

      const datasetAfter = await serverDB.query.agentEvalDatasets.findFirst({
        where: eq(agentEvalDatasets.id, scoped.id),
      });
      expect(datasetAfter).toBeDefined();
      expect(datasetAfter!.sourceExperimentId).toBeNull();
    });
  });

  describe('touch', () => {
    it('should bump accessedAt', async () => {
      const bench = await createBenchmark();
      const experiment = await experimentModel.create({ benchmarkIds: [bench.id], name: 'Touch' });

      const before = experiment.accessedAt;
      // Ensure a measurable difference
      await new Promise((resolve) => setTimeout(resolve, 5));
      const touched = await experimentModel.touch(experiment.id);

      expect(touched).toBeDefined();
      expect(new Date(touched!.accessedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime(),
      );
    });
  });
});
