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

const serverDB = await getTestDB();

const userId = 'experiment-schema-test-user';

beforeEach(async () => {
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalExperimentBenchmarks);
  await serverDB.delete(agentEvalExperiments);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);

  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalExperimentBenchmarks);
  await serverDB.delete(agentEvalExperiments);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);
});

describe('agent eval experiment schema', () => {
  it('supports create, read, update, and delete for experiments', async () => {
    const [created] = await serverDB
      .insert(agentEvalExperiments)
      .values({
        description: 'Initial description',
        metadata: { stage: 'baseline' },
        name: 'Search Skill Acceptance',
        userId,
      })
      .returning();

    expect(created.userId).toBe(userId);
    expect(created.name).toBe('Search Skill Acceptance');

    const [found] = await serverDB
      .select()
      .from(agentEvalExperiments)
      .where(eq(agentEvalExperiments.id, created.id))
      .limit(1);

    expect(found).toBeDefined();
    expect(found?.metadata).toEqual({ stage: 'baseline' });

    const [updated] = await serverDB
      .update(agentEvalExperiments)
      .set({
        description: 'Updated description',
        metadata: { stage: 'iteration' },
        name: 'Search Skill Iteration',
      })
      .where(eq(agentEvalExperiments.id, created.id))
      .returning();

    expect(updated.name).toBe('Search Skill Iteration');
    expect(updated.description).toBe('Updated description');
    expect(updated.metadata).toEqual({ stage: 'iteration' });

    await serverDB.delete(agentEvalExperiments).where(eq(agentEvalExperiments.id, created.id));

    const [deleted] = await serverDB
      .select()
      .from(agentEvalExperiments)
      .where(eq(agentEvalExperiments.id, created.id))
      .limit(1);

    expect(deleted).toBeUndefined();
  });

  it('supports create and delete for experiment-benchmark associations', async () => {
    const [benchmark] = await serverDB
      .insert(agentEvalBenchmarks)
      .values({
        identifier: 'benchmark-for-association',
        isSystem: false,
        name: 'Benchmark For Association',
        rubrics: [],
        userId,
      })
      .returning();

    const [experiment] = await serverDB
      .insert(agentEvalExperiments)
      .values({
        name: 'Association Experiment',
        userId,
      })
      .returning();

    await serverDB.insert(agentEvalExperimentBenchmarks).values({
      benchmarkId: benchmark.id,
      experimentId: experiment.id,
    });

    const associations = await serverDB
      .select()
      .from(agentEvalExperimentBenchmarks)
      .where(eq(agentEvalExperimentBenchmarks.experimentId, experiment.id));

    expect(associations).toHaveLength(1);
    expect(associations[0]?.benchmarkId).toBe(benchmark.id);

    await serverDB
      .delete(agentEvalExperimentBenchmarks)
      .where(eq(agentEvalExperimentBenchmarks.experimentId, experiment.id));

    const remaining = await serverDB
      .select()
      .from(agentEvalExperimentBenchmarks)
      .where(eq(agentEvalExperimentBenchmarks.experimentId, experiment.id));

    expect(remaining).toHaveLength(0);
  });

  it('sets dataset sourceExperimentId to null when deleting the source experiment', async () => {
    const [benchmark] = await serverDB
      .insert(agentEvalBenchmarks)
      .values({
        identifier: 'benchmark-for-dataset-source',
        isSystem: false,
        name: 'Benchmark For Dataset Source',
        rubrics: [],
        userId,
      })
      .returning();

    const [experiment] = await serverDB
      .insert(agentEvalExperiments)
      .values({
        name: 'Dataset Source Experiment',
        userId,
      })
      .returning();

    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({
        benchmarkId: benchmark.id,
        identifier: 'dataset-from-experiment',
        name: 'Dataset From Experiment',
        sourceExperimentId: experiment.id,
        userId,
      })
      .returning();

    await serverDB.delete(agentEvalExperiments).where(eq(agentEvalExperiments.id, experiment.id));

    const [updatedDataset] = await serverDB
      .select()
      .from(agentEvalDatasets)
      .where(eq(agentEvalDatasets.id, dataset.id))
      .limit(1);

    expect(updatedDataset?.sourceExperimentId).toBeNull();
  });

  it('prevents deleting an experiment when runs still reference it', async () => {
    const [benchmark] = await serverDB
      .insert(agentEvalBenchmarks)
      .values({
        identifier: 'benchmark-for-run-reference',
        isSystem: false,
        name: 'Benchmark For Run Reference',
        rubrics: [],
        userId,
      })
      .returning();

    const [experiment] = await serverDB
      .insert(agentEvalExperiments)
      .values({
        name: 'Run Reference Experiment',
        userId,
      })
      .returning();

    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({
        benchmarkId: benchmark.id,
        identifier: 'dataset-for-run-reference',
        name: 'Dataset For Run Reference',
        userId,
      })
      .returning();

    await serverDB.insert(agentEvalRuns).values({
      datasetId: dataset.id,
      experimentId: experiment.id,
      userId,
    });

    await expect(
      serverDB.delete(agentEvalExperiments).where(eq(agentEvalExperiments.id, experiment.id)),
    ).rejects.toThrow();
  });

  it('stores parentRunId for run lineage', async () => {
    const [benchmark] = await serverDB
      .insert(agentEvalBenchmarks)
      .values({
        identifier: 'benchmark-for-lineage',
        isSystem: false,
        name: 'Benchmark For Lineage',
        rubrics: [],
        userId,
      })
      .returning();

    const [experiment] = await serverDB
      .insert(agentEvalExperiments)
      .values({
        name: 'Lineage Experiment',
        userId,
      })
      .returning();

    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({
        benchmarkId: benchmark.id,
        identifier: 'dataset-for-lineage',
        name: 'Dataset For Lineage',
        userId,
      })
      .returning();

    const [parentRun] = await serverDB
      .insert(agentEvalRuns)
      .values({
        datasetId: dataset.id,
        experimentId: experiment.id,
        name: 'Parent Run',
        userId,
      })
      .returning();

    const [childRun] = await serverDB
      .insert(agentEvalRuns)
      .values({
        datasetId: dataset.id,
        experimentId: experiment.id,
        name: 'Child Run',
        parentRunId: parentRun.id,
        userId,
      })
      .returning();

    expect(childRun.parentRunId).toBe(parentRun.id);
  });
});
