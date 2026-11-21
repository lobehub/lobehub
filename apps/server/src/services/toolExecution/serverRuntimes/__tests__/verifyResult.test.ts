import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyResultRuntime } from '../verifyResult';

const mocks = vi.hoisted(() => ({
  operationFindById: vi.fn(),
  runFindByOperation: vi.fn(),
  resultUpdateByCheckItem: vi.fn(),
  resultUpdateByCheckItemIfPending: vi.fn(),
  resultListByRun: vi.fn(),
  statusRecompute: vi.fn(),
  finalizeVerifyRun: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return { findById: mocks.operationFindById };
  }),
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn().mockImplementation(function () {
    return {
      listByRun: mocks.resultListByRun,
      updateByCheckItem: mocks.resultUpdateByCheckItem,
      updateByCheckItemIfPending: mocks.resultUpdateByCheckItemIfPending,
    };
  }),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn().mockImplementation(function () {
    return { findByOperation: mocks.runFindByOperation };
  }),
}));

vi.mock('@/server/services/verify', () => ({
  finalizeVerifyRun: mocks.finalizeVerifyRun,
  VerifyStatusService: vi.fn().mockImplementation(function () {
    return { recompute: mocks.statusRecompute };
  }),
}));

const factoryContext = {
  operationId: 'op-verifier-child',
  serverDB: {} as never,
  userId: 'user-1',
  workspaceId: 'ws-1',
} as never;

const buildRuntime = () =>
  (
    verifyResultRuntime.factory as unknown as (ctx: typeof factoryContext) => {
      submitVerifyResult: (
        params: unknown,
      ) => Promise<{ content: string; error?: string; success: boolean }>;
    }
  )(factoryContext);

describe('verifyResultRuntime.submitVerifyResult', () => {
  let runtime: ReturnType<typeof buildRuntime>;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = buildRuntime();
  });

  it('loud-fails with NO_PARENT_VERIFICATION when the calling op has no parent', async () => {
    mocks.operationFindById.mockResolvedValue(null);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'derived-id',
      verdict: 'passed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_PARENT_VERIFICATION');
    expect(result.content).toContain('No parent verification context');
    expect(mocks.runFindByOperation).not.toHaveBeenCalled();
  });

  it('returns an actionable NO_RUN message when the parent run has no verification session', async () => {
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue(null);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'derived-id',
      verdict: 'passed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_RUN');
    // The message must name the escape hatch instead of the bare opaque error.
    expect(result.content).toContain('report your verdict in your reply');
    expect(mocks.resultUpdateByCheckItemIfPending).not.toHaveBeenCalled();
  });

  it('returns an idempotent receipt instead of overwriting an already-terminal verdict', async () => {
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    // Fast-path settlement retry: the re-read must observe the settled run
    // (status "failed") so the settlement tail re-runs idempotently.
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });
    mocks.resultListByRun.mockResolvedValue([
      {
        checkItemId: 'check-1',
        status: 'failed',
        verdict: 'failed',
      },
    ]);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      verdict: 'passed',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('already recorded');
    expect(mocks.resultUpdateByCheckItemIfPending).not.toHaveBeenCalled();
    // Duplicate calls execute the idempotent settlement path (rollup recompute
    // + finalizer) so a verdict persisted without a completed settle recovers.
    expect(mocks.statusRecompute).toHaveBeenCalledWith('op-parent', { preserveRepairClaim: true });
    expect(mocks.finalizeVerifyRun).toHaveBeenCalled();
  });

  it('re-runs settlement on a duplicate submission whose verdict already landed but finalize never completed', async () => {
    // P1 regression: the first call persisted the verdict, then
    // finalizeVerifyRun() threw (e.g. while starting an auto repair). The row
    // is terminal, so every retry used to take the fast path, report success,
    // and never retry finalization — leaving the run unsettled where the
    // stuck-verification sweep cannot recover it.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });
    mocks.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'uncertain' },
    ]);
    mocks.statusRecompute.mockResolvedValue('failed');
    mocks.finalizeVerifyRun.mockResolvedValue(undefined);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      verdict: 'uncertain',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('already recorded');
    expect(mocks.statusRecompute).toHaveBeenCalledWith('op-parent', { preserveRepairClaim: true });
    expect(mocks.finalizeVerifyRun).toHaveBeenCalled();
  });

  it('loud-fails the duplicate receipt when the settlement retry itself fails', async () => {
    // A settlement retry that throws must surface as an error receipt — not a
    // success ack — so the caller retries instead of trusting a no-op.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });
    mocks.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);
    mocks.statusRecompute.mockRejectedValue(new Error('rollup write failed'));

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      verdict: 'passed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('SETTLEMENT_INCOMPLETE');
    expect(result.content).toContain('already recorded');
    expect(result.content).toContain('settlement did not complete');
    expect(mocks.finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('does not re-run settlement while a repair round is in flight', async () => {
    // status "repairing" owns settlement from here on; touching the rollup or
    // finalizer now would race the repair round's own completion path.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'repairing' });
    mocks.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      verdict: 'passed',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('already recorded');
    expect(mocks.statusRecompute).not.toHaveBeenCalled();
    expect(mocks.finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('still records a fresh verdict and finalizes the run when no prior result exists', async () => {
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1' });
    mocks.resultListByRun.mockResolvedValue([]);
    mocks.resultUpdateByCheckItemIfPending.mockResolvedValue([{ status: 'passed' }]);
    mocks.statusRecompute.mockResolvedValue(undefined);
    mocks.finalizeVerifyRun.mockResolvedValue(undefined);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-2',
      evidence: 'tests pass',
      reasoning: 'unit tests green',
      verdict: 'passed',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Recorded verdict');
    expect(mocks.resultUpdateByCheckItemIfPending).toHaveBeenCalledWith(
      'run-1',
      'check-2',
      expect.objectContaining({ status: 'passed', verdict: 'passed' }),
    );
    expect(mocks.statusRecompute).toHaveBeenCalledWith('op-parent', { preserveRepairClaim: true });
    expect(mocks.finalizeVerifyRun).toHaveBeenCalled();
  });

  it('loud-fails with NO_PARENT_VERIFICATION when the parent op exists but has no parentOperationId', async () => {
    // TS2345 regression: `parentOperationId` is `string | null` — a null value
    // must be guarded, not passed into the run lookup as `string`.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: null });

    const result = await runtime.submitVerifyResult({
      checkItemId: 'derived-id',
      verdict: 'passed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_PARENT_VERIFICATION');
    expect(mocks.runFindByOperation).not.toHaveBeenCalled();
  });

  it('reports the stored verdict (not the mapped status) on an idempotent duplicate', async () => {
    // P2 regression: an `uncertain` verdict is persisted with status "failed";
    // the receipt must echo the verdict, not claim "failed" was recorded.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1' });
    mocks.resultListByRun.mockResolvedValue([
      {
        checkItemId: 'check-1',
        status: 'failed',
        verdict: 'uncertain',
      },
    ]);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      verdict: 'passed',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('"uncertain"');
    expect(result.content).not.toContain('"failed"');
  });

  it('loses the race gracefully when a concurrent submission lands between the read and the write', async () => {
    // P1 regression: both concurrent calls can pass listByRun() before either
    // write lands; the atomic pending-guard update must return no rows for the
    // loser, which then reports the persisted verdict instead of overwriting.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    // First findByOperation (post-write settlement): run settled normally.
    mocks.runFindByOperation.mockResolvedValueOnce({ id: 'run-1', status: 'failed' });
    // First read (fast path): row still pending → passes the terminal check.
    mocks.resultListByRun.mockResolvedValueOnce([
      { checkItemId: 'check-1', status: 'pending', verdict: null },
    ]);
    mocks.resultUpdateByCheckItemIfPending.mockResolvedValue([]);
    // Re-read after losing the race: the winner's verdict is now terminal.
    mocks.resultListByRun.mockResolvedValueOnce([
      { checkItemId: 'check-1', status: 'failed', verdict: 'uncertain' },
    ]);
    mocks.statusRecompute.mockResolvedValue('failed');
    mocks.finalizeVerifyRun.mockResolvedValue(undefined);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      evidence: 'second writer',
      verdict: 'passed',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('already recorded');
    expect(result.content).toContain('"uncertain"');
    // The loser skips writing (winner owns the verdict) but must still run the
    // idempotent settlement tail — the winner's own settlement may have failed.
    expect(mocks.resultUpdateByCheckItemIfPending).toHaveBeenCalled();
    expect(mocks.statusRecompute).toHaveBeenCalledWith('op-parent', { preserveRepairClaim: true });
    expect(mocks.finalizeVerifyRun).toHaveBeenCalled();
  });

  it('retries settlement after losing the race when the winner left the run unsettled', async () => {
    // P1 regression: the winner persisted its verdict, then its settlement
    // threw; the loser used to acknowledge success without recomputing or
    // finalizing, leaving the run terminal-but-unsettled where the sweep
    // cannot recover it.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });
    mocks.resultListByRun
      .mockResolvedValueOnce([{ checkItemId: 'check-1', status: 'pending', verdict: null }])
      .mockResolvedValueOnce([{ checkItemId: 'check-1', status: 'failed', verdict: 'uncertain' }]);
    mocks.resultUpdateByCheckItemIfPending.mockResolvedValue([]);
    mocks.statusRecompute.mockResolvedValue('failed');
    mocks.finalizeVerifyRun.mockResolvedValue(undefined);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      verdict: 'passed',
    });

    expect(result.success).toBe(true);
    expect(mocks.statusRecompute).toHaveBeenCalledWith('op-parent', { preserveRepairClaim: true });
    expect(mocks.finalizeVerifyRun).toHaveBeenCalled();
  });

  it('loud-fails after losing the race when the settlement retry itself fails', async () => {
    // The race-lost path must surface settlement failure through the same
    // SETTLEMENT_INCOMPLETE receipt as the terminal fast path — never a
    // success ack over an unsettled run.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });
    mocks.resultListByRun
      .mockResolvedValueOnce([{ checkItemId: 'check-1', status: 'pending', verdict: null }])
      .mockResolvedValueOnce([{ checkItemId: 'check-1', status: 'failed', verdict: 'uncertain' }]);
    mocks.resultUpdateByCheckItemIfPending.mockResolvedValue([]);
    mocks.statusRecompute.mockRejectedValue(new Error('rollup write failed'));

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      verdict: 'passed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('SETTLEMENT_INCOMPLETE');
    expect(result.content).toContain('already recorded');
    expect(result.content).toContain('settlement did not complete');
  });

  it('skips the settlement tail after losing the race while a repair round is in flight', async () => {
    // status "repairing" owns settlement from here on; the race-lost duplicate
    // must not touch the rollup or finalizer any more than the fast path.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'repairing' });
    mocks.resultListByRun
      .mockResolvedValueOnce([{ checkItemId: 'check-1', status: 'pending', verdict: null }])
      .mockResolvedValueOnce([{ checkItemId: 'check-1', status: 'failed', verdict: 'uncertain' }]);
    mocks.resultUpdateByCheckItemIfPending.mockResolvedValue([]);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      verdict: 'passed',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('already recorded');
    expect(mocks.statusRecompute).not.toHaveBeenCalled();
    expect(mocks.finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('leaves a repair claim taken after the duplicate read the run as failed', async () => {
    // Interleaving: the duplicate reads the run as `failed`, then another
    // finalizer claims it `repairing`. The recompute must keep that claim
    // (reported as `repairing`) and the duplicate must not finalize, or it
    // would claim and spawn a second repair for the same failures.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });
    mocks.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);
    mocks.statusRecompute.mockResolvedValue('repairing');

    const result = await runtime.submitVerifyResult({ checkItemId: 'check-1', verdict: 'failed' });

    expect(result.success).toBe(true);
    expect(mocks.statusRecompute).toHaveBeenCalledWith('op-parent', { preserveRepairClaim: true });
    expect(mocks.finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('leaves a repair claim taken after a race-lost duplicate read the run as failed', async () => {
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });
    mocks.resultListByRun
      .mockResolvedValueOnce([{ checkItemId: 'check-1', status: 'pending', verdict: null }])
      .mockResolvedValueOnce([{ checkItemId: 'check-1', status: 'failed', verdict: 'failed' }]);
    mocks.resultUpdateByCheckItemIfPending.mockResolvedValue([]);
    mocks.statusRecompute.mockResolvedValue('repairing');

    const result = await runtime.submitVerifyResult({ checkItemId: 'check-1', verdict: 'failed' });

    expect(result.success).toBe(true);
    expect(mocks.finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('records a late optional verdict without finalizing a run a repair round holds', async () => {
    // A required check already failed and its finalizer claimed the repair;
    // an optional check's verdict lands afterwards. Its settlement must not
    // overwrite the claim or finalize the run again.
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'repairing' });
    mocks.resultListByRun.mockResolvedValue([
      { checkItemId: 'optional-1', status: 'pending', verdict: null },
    ]);
    mocks.resultUpdateByCheckItemIfPending.mockResolvedValue([{ id: 'result-1' }]);
    mocks.statusRecompute.mockResolvedValue('repairing');

    const result = await runtime.submitVerifyResult({
      checkItemId: 'optional-1',
      verdict: 'passed',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Recorded verdict');
    expect(mocks.statusRecompute).toHaveBeenCalledWith('op-parent', { preserveRepairClaim: true });
    expect(mocks.finalizeVerifyRun).not.toHaveBeenCalled();
  });
});
