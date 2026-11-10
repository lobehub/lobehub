// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VERIFY_ABANDONED_MS, VERIFY_ROLLUP_GRACE_MS } from '../staleness';
import { sweepStuckVerifyRuns } from '../sweep';

const {
  releaseUndeliveredRound,
  settleFailedRepair,
  claimVerifying,
  findStuckVerifying,
  listByAcceptance,
  messageFindById,
  operationFindById,
  recompute,
  recordVerifierRedrive,
  redriveClaimedVerification,
  resultListByRun,
  upsertByCheckItem,
  finalizeVerifyRun,
  findVerifyMessageByOperationId,
} = vi.hoisted(() => ({
  releaseUndeliveredRound: vi.fn(),
  settleFailedRepair: vi.fn(),
  claimVerifying: vi.fn(),
  finalizeVerifyRun: vi.fn(),
  findStuckVerifying: vi.fn(),
  findVerifyMessageByOperationId: vi.fn(),
  listByAcceptance: vi.fn(),
  messageFindById: vi.fn(),
  operationFindById: vi.fn(),
  recompute: vi.fn(),
  recordVerifierRedrive: vi.fn(),
  redriveClaimedVerification: vi.fn(),
  resultListByRun: vi.fn(),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: Object.assign(
    vi.fn(function () {
      return { listByAcceptance, recordVerifierRedrive };
    }),
    { findStuckVerifying },
  ),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun: resultListByRun, upsertByCheckItem };
  }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: operationFindById };
  }),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(function () {
    return { claimVerifying, recompute };
  }),
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return { findById: messageFindById, findVerifyMessageByOperationId };
  }),
}));
vi.mock('../lifecycle', () => ({ redriveClaimedVerification }));
vi.mock('../repairTerminal', () => ({ settleFailedRepair }));
vi.mock('../undeliveredRound', () => ({ releaseUndeliveredRound }));
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

/** Answer the first page and then an empty one, so the keyset loop terminates. */
const singlePage = (runs: unknown[]) => {
  findStuckVerifying.mockResolvedValueOnce(runs).mockResolvedValue([]);
};

describe('sweepStuckVerifyRuns', () => {
  beforeEach(() => {
    [
      releaseUndeliveredRound,
      settleFailedRepair,
      claimVerifying,
      finalizeVerifyRun,
      findStuckVerifying,
      findVerifyMessageByOperationId,
      listByAcceptance,
      messageFindById,
      operationFindById,
      recompute,
      recordVerifierRedrive,
      redriveClaimedVerification,
      resultListByRun,
      upsertByCheckItem,
    ].forEach((m) => m.mockReset());
    findStuckVerifying.mockResolvedValue([]);
    resultListByRun.mockResolvedValue([]);
    claimVerifying.mockResolvedValue(true);
  });

  it('recomputes a run whose checks all landed but whose rollup was lost', async () => {
    // The exact state a killed post-response judge leaves behind: every verdict
    // is on disk, only `verify_runs.status` never caught up.
    singlePage([stuckRun()]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'failed', verdict: 'uncertain' },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.settled).toEqual(['run-1']);
    // Nothing is re-judged — the sweep only derives.
    expect(upsertByCheckItem).not.toHaveBeenCalled();
    expect(recompute).toHaveBeenCalledWith('op-1');
    expect(finalizeVerifyRun).toHaveBeenCalledWith(db, 'u1', 'op-1', {}, undefined);
  });

  it('leaves a run alone until the rollup grace elapses', async () => {
    findStuckVerifying.mockResolvedValue([]);

    await sweepStuckVerifyRuns(db, { now: NOW });

    expect(findStuckVerifying).toHaveBeenCalledWith(
      db,
      new Date(NOW.getTime() - VERIFY_ROLLUP_GRACE_MS),
      expect.objectContaining({ after: undefined }),
    );
  });

  it('holds off on a run with checks still pending until the abandoned bound', async () => {
    singlePage([stuckRun()]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'pending', verdict: null },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(upsertByCheckItem).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
  });

  it('errors out checks left pending past the abandoned bound, then rolls up', async () => {
    singlePage([stuckRun({ updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000) })]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'running', verdict: null },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.abandoned).toEqual(['run-1']);
    expect(upsertByCheckItem).toHaveBeenCalledTimes(1);
    // `errored`, not `failed`: the verifier never judged, so this must not gate
    // delivery or seed auto-repair.
    expect(upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({ checkItemId: 'c1', status: 'errored', verifyRunId: 'run-1' }),
    );
    expect(recompute).toHaveBeenCalledWith('op-1');
  });

  it('never touches a check whose verifier operation is still live', async () => {
    singlePage([stuckRun({ updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000) })]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'running', verifierOperationId: 'verifier-op', verdict: null },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);
    operationFindById.mockResolvedValue({ id: 'verifier-op', status: 'running' });

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(upsertByCheckItem).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
  });

  it('closes a check whose verifier operation already died', async () => {
    singlePage([stuckRun({ updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000) })]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'running', verifierOperationId: 'verifier-op', verdict: null },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);
    operationFindById.mockResolvedValue({ id: 'verifier-op', status: 'error' });

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.abandoned).toEqual(['run-1']);
  });

  it('ignores optional checks when deciding whether anything is outstanding', async () => {
    singlePage([
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
    singlePage([
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

  it('creates the missing rows for a run interrupted before its results existed', async () => {
    // Entering `verifying` happens before the pending rows are written, so a run
    // can be stranded with plan items that have no row at all. Updating in place
    // would touch nothing and leave the run stuck while reporting it recovered.
    singlePage([stuckRun({ updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000) })]);
    resultListByRun.mockResolvedValue([]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.abandoned).toEqual(['run-1']);
    expect(upsertByCheckItem).toHaveBeenCalledTimes(2);
    expect(upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({ checkItemId: 'c1', status: 'errored', verifyRunId: 'run-1' }),
    );
    expect(recompute).toHaveBeenCalledWith('op-1');
  });

  it('drops a run whose lease another delivery already holds', async () => {
    // `finalizeVerifyRun` spawns the repair round and `triggerAutoRepair` has no
    // claim of its own, so two overlapping sweeps must not both reach it.
    singlePage([stuckRun()]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'passed', verdict: 'passed' },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);
    claimVerifying.mockResolvedValue(false);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(recompute).not.toHaveBeenCalled();
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('never leases a run it is going to skip', async () => {
    // Claiming re-stamps `updated_at`; doing that to a run we leave alone would
    // push its abandoned deadline forward every tick, so it would never age out.
    singlePage([stuckRun()]);
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'pending', verdict: null },
      { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
    ]);

    await sweepStuckVerifyRuns(db, { now: NOW });

    expect(claimVerifying).not.toHaveBeenCalled();
  });

  it('pages past runs it cannot recover instead of re-reading the oldest slice', async () => {
    // A run whose verifier is still live keeps its timestamp, so it stays at the
    // head of the ordered scan. Without a cursor it would starve everything newer.
    const live = stuckRun({
      id: 'run-live',
      updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 2000),
    });
    findStuckVerifying
      .mockResolvedValueOnce([live])
      .mockResolvedValueOnce([
        stuckRun({
          id: 'run-newer',
          operationId: 'op-newer',
          plan: [{ id: 'c1', required: true }],
        }),
      ])
      .mockResolvedValue([]);
    resultListByRun
      .mockResolvedValueOnce([
        { checkItemId: 'c1', status: 'running', verifierOperationId: 'verifier-op', verdict: null },
        { checkItemId: 'c2', status: 'passed', verdict: 'passed' },
      ])
      .mockResolvedValue([{ checkItemId: 'c1', status: 'passed', verdict: 'passed' }]);
    operationFindById.mockResolvedValue({ id: 'verifier-op', status: 'running' });

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW, pageSize: 1 });

    // The second read resumes after the run it could not touch.
    expect(findStuckVerifying.mock.calls[1][2]).toMatchObject({
      after: { id: 'run-live', updatedAt: live.updatedAt },
    });
    expect(outcome.skipped).toBe(1);
    expect(outcome.settled).toEqual(['run-newer']);
  });
  describe('a round whose judging never started a verifier', () => {
    // The production shape: the completion gate claimed `verifying`, then died
    // before any verifier spawned, so every check is pending with no verifier.
    const neverJudged = (overrides?: Partial<Record<string, unknown>>) =>
      stuckRun({
        acceptanceId: 'acc-1',
        roundIndex: 3,
        updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000),
        ...overrides,
      });

    beforeEach(() => {
      resultListByRun.mockResolvedValue([
        { checkItemId: 'c1', status: 'pending', verifierOperationId: null, verdict: null },
        { checkItemId: 'c2', status: 'pending', verifierOperationId: null, verdict: null },
      ]);
      operationFindById.mockResolvedValue({ id: 'op-1', status: 'done' });
      listByAcceptance.mockResolvedValue([{ roundIndex: 2 }, { roundIndex: 3 }]);
      findVerifyMessageByOperationId.mockResolvedValue({ id: 'card-7', parentId: 'msg-final' });
      messageFindById.mockResolvedValue({ content: 'final delivery', id: 'msg-final' });
    });

    it('judges the latest round again with the final reply instead of closing it', async () => {
      singlePage([neverJudged()]);

      const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

      expect(outcome.redriven).toEqual(['run-1']);
      expect(outcome.abandoned).toEqual([]);
      expect(recordVerifierRedrive).toHaveBeenCalledWith('run-1', NOW);
      expect(redriveClaimedVerification).toHaveBeenCalledWith(
        db,
        'u1',
        { deliverable: 'final delivery', operationId: 'op-1' },
        undefined,
      );
      // The redriven judge owns the ending; nothing is stamped errored.
      expect(upsertByCheckItem).not.toHaveBeenCalled();
      expect(finalizeVerifyRun).not.toHaveBeenCalled();
    });

    it('closes it as errored once it was already re-driven', async () => {
      singlePage([neverJudged({ metadata: { verifierRedrivenAt: '2026-08-09T23:00:00Z' } })]);

      const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

      expect(outcome.abandoned).toEqual(['run-1']);
      expect(redriveClaimedVerification).not.toHaveBeenCalled();
    });

    it('closes a superseded round without driving the task', async () => {
      // r2 and r3 both stranded: r2 must not pause the task r3 is about to judge.
      singlePage([neverJudged({ roundIndex: 2 })]);

      const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

      expect(outcome.abandoned).toEqual(['run-1']);
      expect(redriveClaimedVerification).not.toHaveBeenCalled();
      expect(recompute).toHaveBeenCalledWith('op-1');
      expect(finalizeVerifyRun).not.toHaveBeenCalled();
    });

    it('closes it when the builder run did not finish successfully', async () => {
      singlePage([neverJudged()]);
      operationFindById.mockResolvedValue({ id: 'op-1', status: 'error' });

      const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

      expect(outcome.abandoned).toEqual(['run-1']);
      expect(redriveClaimedVerification).not.toHaveBeenCalled();
    });
  });

  it('recovers a planned repair whose operation died before judging began', async () => {
    singlePage([stuckRun({ status: 'planned' })]);
    settleFailedRepair.mockResolvedValue(true);
    expect((await sweepStuckVerifyRuns(db, { now: NOW })).abandoned).toEqual(['run-1']);
    expect(settleFailedRepair).toHaveBeenCalledWith(db, 'u1', 'op-1', undefined);
    expect(releaseUndeliveredRound).not.toHaveBeenCalled();
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('releases the planned round of a task run that ended without a delivery', async () => {
    singlePage([stuckRun({ status: 'planned' })]);
    settleFailedRepair.mockResolvedValue(false);
    releaseUndeliveredRound.mockResolvedValue(true);
    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });
    expect(outcome.released).toEqual(['run-1']);
    expect(outcome.abandoned).toEqual([]);
    expect(releaseUndeliveredRound).toHaveBeenCalledWith(db, 'u1', 'op-1', undefined);
    expect(claimVerifying).not.toHaveBeenCalled();
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('skips a planned round neither path can close', async () => {
    singlePage([stuckRun({ status: 'planned' })]);
    settleFailedRepair.mockResolvedValue(false);
    releaseUndeliveredRound.mockResolvedValue(false);
    expect((await sweepStuckVerifyRuns(db, { now: NOW })).skipped).toBe(1);
  });
});
