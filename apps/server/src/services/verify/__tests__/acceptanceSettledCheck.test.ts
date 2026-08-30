// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acceptanceFindById: vi.fn(),
  attachToAcceptance: vi.fn(),
  listByAcceptance: vi.fn(),
  listByRuns: vi.fn(),
  runFindById: vi.fn(),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(() => ({
    findById: mocks.acceptanceFindById,
    findPolicyById: mocks.acceptanceFindById,
    update: vi.fn(),
    updatePolicyStatus: vi.fn(),
  })),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    attachToAcceptance: mocks.attachToAcceptance,
    findById: mocks.runFindById,
    listByAcceptance: mocks.listByAcceptance,
  })),
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(() => ({ listByRuns: mocks.listByRuns })),
}));

vi.mock('@/database/models/verifyEvidence', () => ({ VerifyEvidenceModel: vi.fn(() => ({})) }));
vi.mock('@/database/models/verifyReport', () => ({
  VerifyReportModel: vi.fn(() => ({ findByRun: vi.fn().mockResolvedValue(null) })),
}));

const { AcceptanceService } = await import('../acceptanceService');

const ACCEPTANCE = { id: 'acc-1', status: 'delivered', userId: 'u1', visibility: 'public' };

/** A settled result row: passed, and the reviewer accepted it. */
const acceptedResult = (checkItemId: string, verifyRunId: string) => ({
  checkItemId,
  checkItemTitle: checkItemId,
  completedAt: new Date('2026-08-01T00:00:00.000Z'),
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  id: `res-${checkItemId}`,
  required: true,
  status: 'passed',
  userDecision: 'accepted',
  userDecisionDetail: { decidedAt: '2026-08-01T01:00:00.000Z', roundIndex: 1 },
  verdict: 'passed',
  verifyRunId,
});

const planned = (...ids: string[]) => ids.map((id, index) => ({ id, index, title: id }));

const service = () => new AcceptanceService({} as any, 'u1');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acceptanceFindById.mockResolvedValue(ACCEPTANCE);
  mocks.attachToAcceptance.mockResolvedValue({ id: 'run-2', roundIndex: 2 });
  // Round 1 accepted `settled-check`; `open-check` was never ruled on.
  mocks.listByAcceptance.mockResolvedValue([{ acceptanceId: 'acc-1', id: 'run-1', roundIndex: 1 }]);
  mocks.listByRuns.mockResolvedValue([
    acceptedResult('settled-check', 'run-1'),
    { ...acceptedResult('open-check', 'run-1'), userDecision: null, userDecisionDetail: null },
  ]);
});

describe('attaching a round that targets an accepted check', () => {
  it('refuses the round and names the settled check', async () => {
    mocks.runFindById.mockResolvedValue({
      acceptanceId: null,
      id: 'run-2',
      plan: planned('settled-check'),
      userId: 'u1',
    });

    await expect(service().attachRun('run-2', 'acc-1')).rejects.toThrow(/settled-check/);
    // Nothing may be written: a partially attached round is worse than none.
    expect(mocks.attachToAcceptance).not.toHaveBeenCalled();
  });

  it('refuses when the settled check is reached through a superseded id', async () => {
    // Round 1 ran `old-id`; round 2 replaced it with `settled-check`, whose
    // result the reviewer accepted. The union folded `old-id` into that row, so
    // re-running `old-id` now writes straight back into the settled check.
    mocks.listByAcceptance.mockResolvedValue([
      { acceptanceId: 'acc-1', id: 'run-1', plan: planned('old-id'), roundIndex: 1 },
      {
        acceptanceId: 'acc-1',
        id: 'run-1b',
        plan: [{ id: 'settled-check', index: 0, supersedes: ['old-id'], title: 'settled-check' }],
        roundIndex: 2,
      },
    ]);
    mocks.listByRuns.mockResolvedValue([
      { ...acceptedResult('old-id', 'run-1'), userDecision: null, userDecisionDetail: null },
      acceptedResult('settled-check', 'run-1b'),
    ]);
    mocks.runFindById.mockResolvedValue({
      acceptanceId: null,
      id: 'run-2',
      plan: planned('old-id'),
      userId: 'u1',
    });

    await expect(service().attachRun('run-2', 'acc-1')).rejects.toThrow(/old-id/);
    expect(mocks.attachToAcceptance).not.toHaveBeenCalled();
  });

  it("refuses a fresh plan-item id that carries the settled check's sourceCriterionId", async () => {
    // The union keys rows by `sourceCriterionId ?? id`, so a brand-new physical
    // id pointing at the same criterion still lands on the settled row.
    mocks.listByAcceptance.mockResolvedValue([
      {
        acceptanceId: 'acc-1',
        id: 'run-1',
        plan: [{ id: 'physical-1', index: 0, sourceCriterionId: 'crit-a', title: 'crit-a' }],
        roundIndex: 1,
      },
    ]);
    mocks.listByRuns.mockResolvedValue([acceptedResult('physical-1', 'run-1')]);
    mocks.runFindById.mockResolvedValue({
      acceptanceId: null,
      id: 'run-2',
      plan: [{ id: 'physical-2', index: 0, sourceCriterionId: 'crit-a', title: 'crit-a' }],
      userId: 'u1',
    });

    // Names the plan item the author can actually edit, not the criterion id.
    await expect(service().attachRun('run-2', 'acc-1')).rejects.toThrow(/physical-2/);
    expect(mocks.attachToAcceptance).not.toHaveBeenCalled();
  });

  it('refuses a new id that declares it supersedes the settled check', async () => {
    // Superseding folds the accepted row's timeline into the newcomer, so the
    // new result would render under the accepted verdict just the same.
    mocks.runFindById.mockResolvedValue({
      acceptanceId: null,
      id: 'run-2',
      plan: [{ id: 'replacement', index: 0, supersedes: ['settled-check'], title: 'replacement' }],
      userId: 'u1',
    });

    await expect(service().attachRun('run-2', 'acc-1')).rejects.toThrow(/replacement/);
    expect(mocks.attachToAcceptance).not.toHaveBeenCalled();
  });

  it('attaches a round that only touches unreviewed or brand-new checks', async () => {
    mocks.runFindById.mockResolvedValue({
      acceptanceId: null,
      id: 'run-2',
      plan: planned('open-check', 'brand-new-check'),
      userId: 'u1',
    });

    await expect(service().attachRun('run-2', 'acc-1')).resolves.toMatchObject({ roundIndex: 2 });
    expect(mocks.attachToAcceptance).toHaveBeenCalledOnce();
  });
});
