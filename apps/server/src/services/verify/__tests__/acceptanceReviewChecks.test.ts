// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

/**
 * Per-check reviews stamp the verdict on each union row's FINAL result row,
 * and a merged pull request accepts the delivery it was linked to.
 */
const mocks = vi.hoisted(() => ({
  adjudicate: vi.fn(),
  findById: vi.fn(),
  listByAcceptance: vi.fn(),
  resultUpdate: vi.fn(),
  resultModelScopes: [] as unknown[],
  setDecision: vi.fn(),
  taskResolve: vi.fn(),
  taskServiceUpdateStatus: vi.fn(),
  trigger: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(function () {
    return { findById: mocks.findById, updateStatus: mocks.updateStatus };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { listByAcceptance: mocks.listByAcceptance, setDecision: mocks.setDecision };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function (db: unknown) {
    mocks.resultModelScopes.push(db);
    return { update: mocks.resultUpdate };
  }),
}));
vi.mock('@/database/models/verifyReviewPrediction', () => ({
  VerifyReviewPredictionModel: vi.fn(function () {
    return { adjudicate: mocks.adjudicate };
  }),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return { resolve: mocks.taskResolve };
  }),
}));
vi.mock('@/server/services/task', () => ({
  TaskService: vi.fn(function () {
    return { updateStatus: mocks.taskServiceUpdateStatus };
  }),
}));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: mocks.trigger },
}));

const tx = { tx: true };
const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)) };

const result = (id: string, checkItemId: string, verdict = 'failed') => ({
  checkItemId,
  id,
  status: verdict,
  verdict,
  verifyRunId: id.startsWith('r1') ? 'run-1' : 'run-2',
});

const rounds = {
  results: [result('r1-a', 'check-a', 'failed'), result('r2-a', 'check-a', 'passed')],
  runs: [
    { id: 'run-1', plan: [], roundIndex: 1 },
    { id: 'run-2', plan: [{ id: 'check-b', required: true, title: 'B' }], roundIndex: 2 },
  ],
};

const service = () => {
  const instance = new AcceptanceService(db as any, 'owner-1', 'ws-1', {
    actorUserId: 'actor-1',
  });
  vi.spyOn(instance, 'loadRounds').mockResolvedValue(rounds as any);
  return instance;
};

describe('AcceptanceService.reviewChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resultModelScopes.length = 0;
    mocks.findById.mockResolvedValue({ id: 'acc-1', status: 'delivered' });
  });

  it.each([
    { action: 'accept', decision: 'accepted', rejectIntent: undefined },
    { action: 'ignore', decision: 'overridden', rejectIntent: undefined },
    { action: 'reject', decision: 'rejected', rejectIntent: 'unmet' },
  ] as const)(
    '$action stamps $decision on the final result row inside one transaction',
    async ({ action, decision, rejectIntent }) => {
      const output = await service().reviewChecks('acc-1', {
        action,
        checkItemIds: ['check-a'],
        comment: 'note',
        rejectIntent: 'unmet',
      });

      expect(output).toEqual({ resultIds: ['r2-a'] });
      expect(db.transaction).toHaveBeenCalledOnce();
      expect(mocks.resultModelScopes.at(-1)).toBe(tx);
      expect(mocks.resultUpdate).toHaveBeenCalledWith('r2-a', {
        isFalseNegative: expect.any(Boolean),
        isFalsePositive: expect.any(Boolean),
        userDecision: decision,
        userDecisionDetail: {
          comment: 'note',
          decidedAt: expect.any(String),
          decidedBy: 'actor-1',
          roundIndex: 2,
          ...(rejectIntent ? { rejectIntent } : {}),
        },
      });
    },
  );

  it.each([
    { error: 'Unknown check item(s): nope', ids: ['nope'] },
    { error: 'Check(s) never executed — nothing to review: check-b', ids: ['check-b'] },
  ])('rejects $ids before writing', async ({ error, ids }) => {
    await expect(
      service().reviewChecks('acc-1', { action: 'accept', checkItemIds: ids }),
    ).rejects.toThrow(error);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('fails the whole decision when its proposal cannot be answered', async () => {
    mocks.adjudicate.mockResolvedValue(undefined);

    await expect(
      service().reviewChecks('acc-1', {
        action: 'reject',
        checkItemIds: ['check-a'],
        proposal: { adjudication: 'agree', predictionId: 'pred-1' } as any,
      }),
    ).rejects.toThrow('Proposal "pred-1" not found');
    expect(mocks.adjudicate).toHaveBeenCalledWith('pred-1', {
      adjudication: 'agree',
      edit: undefined,
    });
  });
});

describe('AcceptanceService.acceptFromScmMerge', () => {
  const changeRequest = { number: 7, repoFullName: 'org/repo' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listByAcceptance.mockResolvedValue([{ id: 'run-1' }, { id: 'run-2' }]);
    mocks.taskResolve.mockResolvedValue({ id: 'task-1', status: 'running' });
  });

  it('returns null for a missing acceptance and an accepted one unchanged', async () => {
    mocks.findById.mockResolvedValueOnce(undefined);
    await expect(service().acceptFromScmMerge('acc-1', changeRequest)).resolves.toBeNull();

    mocks.findById.mockResolvedValueOnce({ id: 'acc-1', status: 'accepted' });
    await expect(service().acceptFromScmMerge('acc-1', changeRequest)).resolves.toEqual({
      id: 'acc-1',
      status: 'accepted',
    });
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it('stamps the merge on the current round, accepts, and completes the task', async () => {
    mocks.findById
      .mockResolvedValueOnce({
        id: 'acc-1',
        status: 'delivered',
        subjectId: 'task-1',
        subjectType: 'task',
      })
      .mockResolvedValueOnce({ id: 'acc-1', status: 'accepted' });

    await expect(service().acceptFromScmMerge('acc-1', changeRequest)).resolves.toEqual({
      id: 'acc-1',
      status: 'accepted',
    });

    expect(mocks.setDecision).toHaveBeenCalledWith('run-2', 'accept', {
      changeRequest,
      decidedAt: expect.any(String),
      decidedBy: 'actor-1',
      source: 'scm_merge',
    });
    expect(mocks.updateStatus).toHaveBeenCalledWith('acc-1', 'accepted');
    expect(mocks.trigger).toHaveBeenCalledWith({
      acceptanceId: 'acc-1',
      userId: 'owner-1',
      verifyRunId: 'run-2',
      workspaceId: 'ws-1',
    });
    expect(mocks.taskServiceUpdateStatus).toHaveBeenCalledWith({
      id: 'task-1',
      status: 'completed',
    });
  });
});
