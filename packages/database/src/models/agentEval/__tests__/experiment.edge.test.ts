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

const userId = 'experiment-edge-user';
const model = new AgentEvalExperimentModel(serverDB, userId);

const createBenchmark = async () => {
  const [benchmark] = await serverDB
    .insert(agentEvalBenchmarks)
    .values({
      identifier: `bench-edge-${Math.random().toString(36).slice(2, 8)}`,
      isSystem: false,
      name: 'Edge Benchmark',
      rubrics: [],
      userId,
    })
    .returning();
  return benchmark;
};

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

describe('AgentEvalExperimentModel edge cases', () => {
  it('creates an experiment without benchmarks', async () => {
    const created = await model.create({ benchmarkIds: [], name: 'No benchmarks' });

    expect(created.name).toBe('No benchmarks');
    const junctions = await serverDB
      .select()
      .from(agentEvalExperimentBenchmarks)
      .where(eq(agentEvalExperimentBenchmarks.experimentId, created.id));
    expect(junctions).toEqual([]);
  });

  it('query returns zero counts and empty lists for a bare experiment', async () => {
    await model.create({ benchmarkIds: [], name: 'Bare' });

    const [row] = await model.query();

    expect(row).toMatchObject({
      benchmarkCount: 0,
      benchmarks: [],
      datasetCount: 0,
      name: 'Bare',
      recentRuns: [],
      runCount: 0,
    });
  });

  it('findByBenchmarkIds short-circuits an empty input', async () => {
    const benchmark = await createBenchmark();
    const experiment = await model.create({
      benchmarkIds: [benchmark.id],
      name: 'Linked',
    });

    await expect(model.findByBenchmarkIds([])).resolves.toEqual([]);
    expect(await model.findByBenchmarkIds([benchmark.id])).toMatchObject([
      { experimentId: experiment.id, experimentName: 'Linked' },
    ]);
  });

  it('update returns undefined for an experiment the caller cannot see', async () => {
    await expect(model.update('missing-experiment', { name: 'Nope' })).resolves.toBeUndefined();
  });

  it('update with an empty benchmark list clears the junctions', async () => {
    const benchmark = await createBenchmark();
    const experiment = await model.create({
      benchmarkIds: [benchmark.id],
      name: 'Clear me',
    });

    const updated = await model.update(experiment.id, { benchmarkIds: [] });

    expect(updated).toMatchObject({ id: experiment.id });
    const junctions = await serverDB
      .select()
      .from(agentEvalExperimentBenchmarks)
      .where(eq(agentEvalExperimentBenchmarks.experimentId, experiment.id));
    expect(junctions).toEqual([]);
  });

  it('update without benchmarkIds leaves existing junctions alone', async () => {
    const benchmark = await createBenchmark();
    const experiment = await model.create({
      benchmarkIds: [benchmark.id],
      name: 'Keep junctions',
    });

    await model.update(experiment.id, { description: 'updated' });

    const junctions = await serverDB
      .select()
      .from(agentEvalExperimentBenchmarks)
      .where(eq(agentEvalExperimentBenchmarks.experimentId, experiment.id));
    expect(junctions).toHaveLength(1);
  });

  it('rethrows a unique violation it cannot resolve to a visible experiment', async () => {
    const id = 'experiment-owned-by-someone-else';
    await serverDB.insert(users).values({ id: 'experiment-other-owner' });
    await serverDB
      .insert(agentEvalExperiments)
      .values({ id, name: 'other', userId: 'experiment-other-owner' });

    await expect(model.create({ benchmarkIds: [], id, name: 'mine' })).rejects.toThrow();
  });
});
