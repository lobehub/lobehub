// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { carryPassedResultsForward, settledCarriedItemIds } from '../carryForward';

const mocks = vi.hoisted(() => ({
  evidenceCreateMany: vi.fn(),
  evidenceListByCheckResult: vi.fn(),
  resultListByRun: vi.fn(),
  resultUpsert: vi.fn(),
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun: mocks.resultListByRun, upsertByCheckItem: mocks.resultUpsert };
  }),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return {
      createMany: mocks.evidenceCreateMany,
      listByCheckResult: mocks.evidenceListByCheckResult,
    };
  }),
}));

const plan = [
  { id: 'list', index: 0, required: true, title: 'List', verifierType: 'agent' },
  { id: 'reader', index: 1, required: true, title: 'Reader', verifierType: 'agent' },
  { id: 'keys', index: 2, required: true, title: 'Keys', verifierType: 'agent' },
] as never;

describe('carryPassedResultsForward', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resultUpsert.mockImplementation(async (row) => ({ id: `new-${row.checkItemId}` }));
    mocks.evidenceCreateMany.mockResolvedValue([]);
  });

  it('copies passed results and their evidence, skipping the checks under repair', async () => {
    mocks.resultListByRun.mockResolvedValue([
      {
        checkItemId: 'list',
        confidence: 0.9,
        id: 'old-list',
        metadata: null,
        status: 'passed',
        toulmin: { reasoning: 'diffs cover all five sites' },
        verdict: 'passed',
      },
      { checkItemId: 'reader', id: 'old-reader', status: 'failed', verdict: 'failed' },
      // Passed in the source round but this repair was asked to redo it.
      { checkItemId: 'keys', id: 'old-keys', status: 'passed', verdict: 'passed' },
    ]);
    mocks.evidenceListByCheckResult.mockResolvedValue([
      {
        checkResultId: 'old-list',
        content: 'diff',
        createdAt: new Date(),
        id: 'ev-1',
        metadata: null,
        type: 'text',
      },
    ]);

    const carried = await carryPassedResultsForward({} as never, 'user-1', {
      excludeItemIds: ['keys'],
      operationId: 'repair-op',
      plan,
      sourceRoundIndex: 2,
      sourceRunId: 'run-2',
      targetRunId: 'run-3',
    });

    expect(carried).toEqual(['list']);
    expect(mocks.resultUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.resultUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        checkItemId: 'list',
        metadata: {
          carriedFrom: { checkResultId: 'old-list', roundIndex: 2, verifyRunId: 'run-2' },
        },
        operationId: 'repair-op',
        status: 'passed',
        toulmin: expect.objectContaining({ reasoning: 'diffs cover all five sites' }),
        verdict: 'passed',
        verifyRunId: 'run-3',
      }),
    );
    expect(mocks.evidenceCreateMany).toHaveBeenCalledWith([
      {
        checkResultId: 'new-list',
        content: 'diff',
        metadata: { carriedFromEvidenceId: 'ev-1' },
        type: 'text',
      },
    ]);
  });

  it('does not carry a result the user rejected', async () => {
    mocks.resultListByRun.mockResolvedValue([
      {
        checkItemId: 'list',
        id: 'old',
        status: 'passed',
        userDecision: 'rejected',
        verdict: 'passed',
      },
    ]);

    expect(
      await carryPassedResultsForward({} as never, 'user-1', {
        operationId: 'repair-op',
        plan,
        sourceRunId: 'run-2',
        targetRunId: 'run-3',
      }),
    ).toEqual([]);
    expect(mocks.resultUpsert).not.toHaveBeenCalled();
  });
});

describe('settledCarriedItemIds', () => {
  const carried = { carriedFrom: { checkResultId: 'r', roundIndex: 1, verifyRunId: 'run-1' } };

  it('settles a carried check backed only by copied evidence', () => {
    expect(
      settledCarriedItemIds(
        [
          { checkItemId: 'a', metadata: carried, status: 'passed' },
          { checkItemId: 'b', metadata: null, status: 'pending' },
        ],
        [
          { checkItemId: 'a', metadata: { carriedFromEvidenceId: 'e1' } },
          { checkItemId: 'b', metadata: null },
        ],
      ),
    ).toEqual({ reopened: [], settled: new Set(['a']) });
  });

  it('reopens a carried check the builder evidenced again', () => {
    expect(
      settledCarriedItemIds(
        [{ checkItemId: 'a', metadata: carried, status: 'passed' }],
        [
          { checkItemId: 'a', metadata: { carriedFromEvidenceId: 'e1' } },
          { checkItemId: 'a', metadata: null },
        ],
      ),
    ).toEqual({ reopened: ['a'], settled: new Set() });
  });
});
