// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkModel } from '..';
import { cleanupWorkTestData, seedWorkTestData, serverDB, userId } from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

describe('WorkModel.listSummariesByRootOperations · type gate', () => {
  it('returns the pre-seeded empty buckets when the caller draws no work type at all', async () => {
    const workModel = new WorkModel(serverDB, userId);

    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-gate-b', 'op-gate-a'],
      types: [],
    });

    expect(summaries).toEqual({ 'op-gate-a': [], 'op-gate-b': [] });
  });
});
