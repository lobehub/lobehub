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
     * The concurrent create commits after our idempotency pre-check and before our insert, so our
     * insert hits a real primary-key violation. drizzle wraps the driver error, putting the code on
     * `cause` rather than on the error itself.
     */
    const commitBeforeInsert = (winner: typeof agentEvalExperiments.$inferInsert) => {
      const transaction = serverDB.transaction.bind(serverDB);
      return vi
        .spyOn(serverDB, 'transaction')
        .mockImplementationOnce(async (run: Parameters<typeof transaction>[0]) => {
          await serverDB.insert(agentEvalExperiments).values(winner);
          return transaction(run);
        });
    };

    it('returns the winner of a create race that surfaces as a unique violation', async () => {
      const id = 'experiment-cov-race-winner';
      commitBeforeInsert({ id, name: 'winner', userId });

      const created = await model.create({ benchmarkIds: [], id, name: 'loser' });

      expect(created.id).toBe(id);
      expect(created.name).toBe('winner');
      const rows = await serverDB
        .select()
        .from(agentEvalExperiments)
        .where(inArray(agentEvalExperiments.id, [id]));
      expect(rows).toHaveLength(1);
    });

    it('rethrows a unique violation whose winner is not visible to the caller', async () => {
      const id = 'experiment-cov-race-hidden';
      commitBeforeInsert({ id, name: 'hidden', userId: otherOwnerId });

      const error = await model.create({ benchmarkIds: [], id, name: 'mine' }).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as { cause?: { code?: string } }).cause?.code).toBe('23505');
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
