// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VERIFY_ABANDONED_MS, VERIFY_ROLLUP_GRACE_MS } from '../staleness';
import { sweepStuckVerifyRuns } from '../sweep';

const {
  findStuckVerifying,
  operationFindById,
  recompute,
  resultListByRun,
  updateByCheckItem,
  finalizeVerifyRun,
} = vi.hoisted(() => ({
  finalizeVerifyRun: vi.fn(),
  findStuckVerifying: vi.fn(),
  operationFindById: vi.fn(),
  recompute: vi.fn(),
  resultListByRun: vi.fn(),
  updateByCheckItem: vi.fn(),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: Object.assign(
    vi.fn(() => ({})),
    { findStuckVerifying },
  ),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(() => ({ listByRun: resultListByRun, updateByCheckItem })),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById: operationFindById })),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(() => ({ recompute })),
}));
vi.mock('../settle', () => ({ finalizeVerifyRun }));

const db = {} as any;
const NOW = new Date('2026-08-10T00:00:00Z');

const stuckRun = (overrides?: Partial<Record<string, unknown>>) => ({
  id: 'run-1',
  operationId: 'op-1',
  plan: [
    { id: 'c1', required: true },
    { id: 'c2', required: true },
  ],
  updatedAt: new Date(NOW.getTime() - VERIFY_ROLLUP_GRACE_MS - 1000),
  userId: 'u1',
  workspaceId: null,
  ...overrides,
});

describe('sweepStuckVerifyRuns', () => {
  beforeEach(() => {
    [
      finalizeVerifyRun,
      findStuckVerifying,
      operationFindById,
      recompute,
      resultListByRun,
      updateByCheckItem,
    ].forEach((m) => m.mockReset());
    findStuckVerifying.mockResolvedValue([]);
    resultListByRun.mockResolvedValue([]);
  });

  it('recomputes a run whose checks all landed but whose rollup was lost', async () => {
    // The exact state a killed post-response judge leaves behind: every verdict
    // is on disk, only `verify_runs.status` never caught up.
    findStuckVerifying.mockResolvedValue([stuckRun()]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'failed', verdict: 'uncertain' },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.settled).toEqual(['run-1']);
    // Nothing is re-judged — the sweep only derives.
    expect(updateByCheckItem).not.toHaveBeenCalled();
    expect(recompute).toHaveBeenCalledWith('op-1');
    expect(finalizeVerifyRun).toHaveBeenCalledWith(db, 'u1', 'op-1', {}, undefined);
  });

  it('leaves a run alone until the rollup grace elapses', async () => {
    findStuckVerifying.mockResolvedValue([]);

    await sweepStuckVerifyRuns(db, { now: NOW });

    expect(findStuckVerifying).toHaveBeenCalledWith(
      db,
      new Date(NOW.getTime() - VERIFY_ROLLUP_GRACE_MS),
    );
  });

  it('holds off on a run with checks still pending until the abandoned bound', async () => {
    findStuckVerifying.mockResolvedValue([stuckRun()]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'pending', verdict: null },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(updateByCheckItem).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
  });

  it('errors out checks left pending past the abandoned bound, then rolls up', async () => {
    findStuckVerifying.mockResolvedValue([
      stuckRun({ updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000) }),
    ]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'running', verdict: null },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.abandoned).toEqual(['run-1']);
    expect(updateByCheckItem).toHaveBeenCalledTimes(1);
    // `errored`, not `failed`: the verifier never judged, so this must not gate
    // delivery or seed auto-repair.
    expect(updateByCheckItem).toHaveBeenCalledWith(
      'run-1',
      'c1',
      expect.objectContaining({ status: 'errored' }),
    );
    expect(recompute).toHaveBeenCalledWith('op-1');
  });

  it('never touches a check whose verifier operation is still live', async () => {
    findStuckVerifying.mockResolvedValue([
      stuckRun({ updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000) }),
    ]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'running', verifierOperationId: 'verifier-op', verdict: null },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);
    operationFindById.mockResolvedValue({ id: 'verifier-op', status: 'running' });

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(updateByCheckItem).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
  });

  it('closes a check whose verifier operation already died', async () => {
    findStuckVerifying.mockResolvedValue([
      stuckRun({ updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000) }),
    ]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'running', verifierOperationId: 'verifier-op', verdict: null },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);
    operationFindById.mockResolvedValue({ id: 'verifier-op', status: 'error' });

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.abandoned).toEqual(['run-1']);
  });

  it('ignores optional checks when deciding whether anything is outstanding', async () => {
    findStuckVerifying.mockResolvedValue([
      stuckRun({
        plan: [
          { id: 'c1', required: true },
          { id: 'c2', required: false },
        ],
      }),
    ]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'passed', verdict: 'passed' },
      { checkItemId: 'c2', status: 'pending', verdict: null },
    ]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.settled).toEqual(['run-1']);
  });

  it('keeps sweeping after one run throws', async () => {
    findStuckVerifying.mockResolvedValue([
      stuckRun({ id: 'run-bad' }),
      stuckRun({ id: 'run-2', operationId: 'op-2', plan: [{ id: 'c1', required: true }] }),
    ]);
    resultListByRun
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([{ checkItemId: 'c1', status: 'passed', verdict: 'passed' }]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(outcome.settled).toEqual(['run-2']);
  });
});
