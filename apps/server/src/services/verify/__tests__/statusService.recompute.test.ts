// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyStatusService } from '../statusService';

const {
  acceptanceRecomputeStatus,
  runFindByOperation,
  runUpdateStatus,
  runUpdateStatusUnlessRepairing,
  resultListByRun,
} = vi.hoisted(() => ({
  acceptanceRecomputeStatus: vi.fn(),
  resultListByRun: vi.fn(),
  runFindByOperation: vi.fn(),
  runUpdateStatus: vi.fn(),
  runUpdateStatusUnlessRepairing: vi.fn(),
}));

vi.mock('../goalLoop', () => ({
  maybeContinueGoalLoop: vi.fn().mockResolvedValue('spawn-failed'),
  syncGoalToolState: vi.fn(),
}));
vi.mock('../acceptanceService', () => ({
  AcceptanceService: vi.fn(function () {
    return {
      recomputeStatus: acceptanceRecomputeStatus,
    };
  }),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return {
      findByOperation: runFindByOperation,
      updateStatus: runUpdateStatus,
      updateStatusUnlessRepairing: runUpdateStatusUnlessRepairing,
    };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun: resultListByRun };
  }),
}));

const db = {} as any;

// One confirmed run whose plan is the given required check items.
const runWith = (items: { id: string }[], acceptanceId?: string) => ({
  acceptanceId,
  id: 'run-1',
  plan: items.map((i) => ({ ...i, required: true })),
  planConfirmedAt: new Date(),
  status: 'verifying',
});

describe('VerifyStatusService.recompute — errored rollup', () => {
  beforeEach(() => {
    [
      acceptanceRecomputeStatus,
      runFindByOperation,
      runUpdateStatus,
      runUpdateStatusUnlessRepairing,
      resultListByRun,
    ].forEach((m) => m.mockReset());
  });

  it('an errored required check (none failed) rolls up to `errored`, not `failed`', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }]));
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'errored', verdict: null }]);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(status).toBe('errored');
    expect(runUpdateStatus).toHaveBeenCalledWith('run-1', 'errored');
  });

  it('a skipped required check rolls up to `errored` instead of passing', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }]));
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'skipped', verdict: null }]);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(status).toBe('errored');
    expect(runUpdateStatus).toHaveBeenCalledWith('run-1', 'errored');
  });

  it('updates the attached acceptance when the verify rollup changes', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }], 'acceptance-1'));
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'passed', verdict: 'passed' }]);

    await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(acceptanceRecomputeStatus).toHaveBeenCalledWith('acceptance-1');
  });

  it('a genuine failure dominates an errored check (delivery still gates)', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }, { id: 'c2' }]));
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'errored', verdict: null },
      { checkItemId: 'c2', status: 'failed', verdict: 'failed' },
    ]);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(status).toBe('failed');
  });

  it('a still-running check keeps the run `verifying` even with an errored sibling', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }, { id: 'c2' }]));
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'errored', verdict: null },
      { checkItemId: 'c2', status: 'running', verdict: null },
    ]);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(status).toBe('verifying');
  });

  it('a required check waived by an upheld dispute no longer gates the round', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }, { id: 'c2' }]));
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'passed', verdict: 'passed' },
      {
        checkItemId: 'c2',
        metadata: {
          dispute: { arbitration: { outcome: 'upheld' }, kind: 'invalid_criterion' },
        },
        status: 'failed',
        verdict: 'failed',
      },
    ]);

    expect(await new VerifyStatusService(db, 'u1').recompute('op-1')).toBe('passed');
  });

  it('an overruled dispute leaves the failed check gating the round', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }]));
    resultListByRun.mockResolvedValue([
      {
        checkItemId: 'c1',
        metadata: {
          dispute: { arbitration: { outcome: 'overruled' }, kind: 'invalid_criterion' },
        },
        status: 'failed',
        verdict: 'failed',
      },
    ]);

    expect(await new VerifyStatusService(db, 'u1').recompute('op-1')).toBe('failed');
  });

  it('all passing required checks still roll up to `passed`', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }]));
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'passed', verdict: 'passed' }]);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(status).toBe('passed');
  });
});

describe('VerifyStatusService.recompute — preserveRepairClaim', () => {
  beforeEach(() => {
    [
      acceptanceRecomputeStatus,
      runFindByOperation,
      runUpdateStatus,
      runUpdateStatusUnlessRepairing,
      resultListByRun,
    ].forEach((m) => m.mockReset());
  });

  it('keeps a repair claim taken between the read and the rollup write', async () => {
    // Read as `verifying`; another finalizer's `claimRepairing` lands before
    // this write, so the conditional update matches nothing.
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }], 'acceptance-1'));
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'failed', verdict: 'failed' }]);
    runUpdateStatusUnlessRepairing.mockResolvedValue(false);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1', {
      preserveRepairClaim: true,
    });

    expect(status).toBe('repairing');
    expect(runUpdateStatusUnlessRepairing).toHaveBeenCalledWith('run-1', 'failed');
    expect(runUpdateStatus).not.toHaveBeenCalled();
    expect(acceptanceRecomputeStatus).not.toHaveBeenCalled();
  });

  it('does not write over a run already read as repairing', async () => {
    runFindByOperation.mockResolvedValue({ ...runWith([{ id: 'c1' }]), status: 'repairing' });

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1', {
      preserveRepairClaim: true,
    });

    expect(status).toBe('repairing');
    expect(runUpdateStatus).not.toHaveBeenCalled();
    expect(runUpdateStatusUnlessRepairing).not.toHaveBeenCalled();
  });

  it('writes the rollup when no claim is held', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }], 'acceptance-1'));
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'failed', verdict: 'failed' }]);
    runUpdateStatusUnlessRepairing.mockResolvedValue(true);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1', {
      preserveRepairClaim: true,
    });

    expect(status).toBe('failed');
    expect(acceptanceRecomputeStatus).toHaveBeenCalledWith('acceptance-1');
  });

  it('still collapses a repairing run when the caller owns the claim’s end', async () => {
    // Repair-chain collapse and the sweep reclaim call without the option.
    runFindByOperation.mockResolvedValue({ ...runWith([{ id: 'c1' }]), status: 'repairing' });
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'failed', verdict: 'failed' }]);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(status).toBe('failed');
    expect(runUpdateStatus).toHaveBeenCalledWith('run-1', 'failed');
  });
});
