import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentEvalDatasets, agentEvalExperiments, agentEvalRuns, users } from '../../../schemas';
import { createProxyTestDB } from '../../__tests__/_proxyTestDB';
import { AgentEvalExperimentModel } from '../experiment';

const serverDB = await getTestDB();

const userId = 'experiment-coverage-user';
const otherOwnerId = 'experiment-coverage-other-owner';
const model = new AgentEvalExperimentModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherOwnerId }]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Experiments, datasets and runs here are all user-owned and cascade with the user.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherOwnerId]));
});

describe('AgentEvalExperimentModel coverage', () => {
  describe('create race', () => {
    /**
     * The concurrent create commits first and ours fails on the primary key. The stand-in throws
     * the driver's error shape (`code` on the error itself) — see the PR "Findings" for why the
     * drizzle-wrapped shape never reaches this branch today.
     */
    it('returns the winner of a create race that surfaces as a unique violation', async () => {
      const id = 'experiment-cov-race-winner';
      vi.spyOn(serverDB, 'transaction').mockImplementationOnce(async () => {
        await serverDB.insert(agentEvalExperiments).values({ id, name: 'winner', userId });
        throw Object.assign(new Error('duplicate key value'), { code: '23505' });
      });

      const created = await model.create({ benchmarkIds: [], id, name: 'loser' });

      expect(created.id).toBe(id);
      expect(created.name).toBe('winner');
    });

    it('rethrows a unique violation whose winner is not visible to the caller', async () => {
      const id = 'experiment-cov-race-hidden';
      const violation = Object.assign(new Error('duplicate key value'), { code: '23505' });
      vi.spyOn(serverDB, 'transaction').mockImplementationOnce(async () => {
        await serverDB
          .insert(agentEvalExperiments)
          .values({ id, name: 'hidden', userId: otherOwnerId });
        throw violation;
      });

      await expect(model.create({ benchmarkIds: [], id, name: 'mine' })).rejects.toBe(violation);
    });
  });

  it('findById skips the dataset lookup for an experiment without benchmarks', async () => {
    const experiment = await model.create({ benchmarkIds: [], name: 'Bare detail' });

    const detail = await model.findById(experiment.id);

    expect(detail?.benchmarks).toEqual([]);
    expect(detail?.datasets).toEqual([]);
    expect(detail?.runs).toEqual([]);
  });

  it('lists a recent run from a dataset outside any benchmark without a benchmark id', async () => {
    const experiment = await model.create({ benchmarkIds: [], name: 'Captured cases' });
    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({ identifier: 'experiment-cov-captured', name: 'Captured', userId })
      .returning();
    await serverDB
      .insert(agentEvalRuns)
      .values({ datasetId: dataset.id, experimentId: experiment.id, userId });

    const [item] = await model.query();

    expect(item.recentRuns).toEqual([
      expect.objectContaining({ benchmarkId: undefined, datasetName: 'Captured' }),
    ]);
  });

  it('drops a ranked run that comes back without an experiment id', async () => {
    const experiment = await model.create({ benchmarkIds: [], name: 'Detached mid-read' });
    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({ identifier: 'experiment-cov-detached', name: 'Detached', userId })
      .returning();
    const [kept, detached] = await serverDB
      .insert(agentEvalRuns)
      .values([
        { datasetId: dataset.id, experimentId: experiment.id, name: 'kept', userId },
        { datasetId: dataset.id, experimentId: experiment.id, name: 'detached', userId },
      ])
      .returning();

    // The ranked-runs read sees one run whose experiment link was cleared concurrently
    // (runs detach with `experiment_id = NULL` when an experiment is deleted).
    const proxyDB = createProxyTestDB(serverDB, (query, { fields, rows }) => {
      if (!query.includes('"ranked_runs"')) return rows;

      const idIndex = fields.findIndex((field) => field.name === 'id');
      const experimentIndex = fields.findIndex((field) => field.name === 'experiment_id');
      return rows.map((row) =>
        row[idIndex] === detached.id
          ? row.map((value, index) => (index === experimentIndex ? null : value))
          : row,
      );
    });

    const [item] = await new AgentEvalExperimentModel(proxyDB, userId).query();

    expect(item.id).toBe(experiment.id);
    expect(item.recentRuns?.map((run) => run.id)).toEqual([kept.id]);
  });
});
