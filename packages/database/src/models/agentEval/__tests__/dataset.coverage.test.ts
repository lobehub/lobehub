import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentEvalBenchmarks, agentEvalDatasets, users } from '../../../schemas';
import { AgentEvalDatasetModel } from '../dataset';

const serverDB = await getTestDB();

const userId = 'dataset-coverage-user';
const datasetModel = new AgentEvalDatasetModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // Benchmarks and datasets below are user-owned, so they cascade with the user.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('AgentEvalDatasetModel coverage', () => {
  it('filters the list by benchmarkId', async () => {
    const [first, second] = await serverDB
      .insert(agentEvalBenchmarks)
      .values([
        { identifier: 'dataset-cov-a', isSystem: false, name: 'A', rubrics: [], userId },
        { identifier: 'dataset-cov-b', isSystem: false, name: 'B', rubrics: [], userId },
      ])
      .returning();
    await serverDB.insert(agentEvalDatasets).values([
      { benchmarkId: first.id, identifier: 'dataset-cov-in-a', name: 'In A', userId },
      { benchmarkId: second.id, identifier: 'dataset-cov-in-b', name: 'In B', userId },
    ]);

    const filtered = await datasetModel.queryList({ benchmarkId: second.id });

    expect(filtered.map((d) => d.identifier)).toEqual(['dataset-cov-in-b']);
    expect(await datasetModel.count({ benchmarkId: second.id })).toBe(1);
  });
});
