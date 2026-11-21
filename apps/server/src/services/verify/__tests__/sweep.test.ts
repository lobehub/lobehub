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
  operationListTree,
  reclaimRepairing,
  recompute,
  recordVerifierRedrive,
  redriveClaimedVerification,
  resultListByRun,
  runVerifyAfterEvidenceSubmission,
  runVerifyOnCompletion,
  upsertByCheckItem,
  finalizeVerifyRun,
  findVerifyMessageByOperationId,
  findLatestAssistantByOperationId,
  runFindByOperation,
  recordAutoRepair,
} = vi.hoisted(() => ({
  releaseUndeliveredRound: vi.fn(),
  settleFailedRepair: vi.fn(),
  claimVerifying: vi.fn(),
  finalizeVerifyRun: vi.fn(),
  findStuckVerifying: vi.fn(),
  findVerifyMessageByOperationId: vi.fn(),
  findLatestAssistantByOperationId: vi.fn(),
  listByAcceptance: vi.fn(),
  messageFindById: vi.fn(),
  operationFindById: vi.fn(),
  operationListTree: vi.fn(),
  reclaimRepairing: vi.fn(),
  recompute: vi.fn(),
  recordVerifierRedrive: vi.fn(),
  redriveClaimedVerification: vi.fn(),
  resultListByRun: vi.fn(),
  runVerifyAfterEvidenceSubmission: vi.fn(),
  runVerifyOnCompletion: vi.fn(),
  upsertByCheckItem: vi.fn(),
  runFindByOperation: vi.fn(),
  recordAutoRepair: vi.fn(),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: Object.assign(
    vi.fn(function () {
      return {
        findByOperation: runFindByOperation,
        listByAcceptance,
        reclaimRepairing,
        recordAutoRepair,
        recordVerifierRedrive,
      };
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
    return { findById: operationFindById, listOperationTree: operationListTree };
  }),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(function () {
    return { claimVerifying, recompute };
  }),
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return {
      findById: messageFindById,
      findLatestAssistantByOperationId,
      findVerifyMessageByOperationId,
    };
  }),
}));
vi.mock('../lifecycle', () => ({
  redriveClaimedVerification,
  runVerifyAfterEvidenceSubmission,
  runVerifyOnCompletion,
}));
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
      findLatestAssistantByOperationId,
      listByAcceptance,
      messageFindById,
      operationFindById,
      operationListTree,
      reclaimRepairing,
      recompute,
      recordVerifierRedrive,
      redriveClaimedVerification,
      resultListByRun,
      runVerifyAfterEvidenceSubmission,
      runVerifyOnCompletion,
      upsertByCheckItem,
      runFindByOperation,
      recordAutoRepair,
    ].forEach((m) => m.mockReset());
    findStuckVerifying.mockResolvedValue([]);
    resultListByRun.mockResolvedValue([]);
    claimVerifying.mockResolvedValue(true);
    reclaimRepairing.mockResolvedValue(true);
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

  it('reclaims a stale repairing claim with no repair child and re-drives repair', async () => {
    // The shape a worker killed between `claimRepairing` and the spawn leaves
    // behind: the run is parked in `repairing` forever — both repair paths
    // skip that status — unless the sweep reclaims it.
    singlePage([stuckRun({ status: 'repairing' })]);
    operationListTree.mockResolvedValue([{ id: 'op-1', parentOperationId: null }]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.settled).toEqual(['run-1']);
    // The rollup is recomputed (releasing the stale claim back to the derived
    // verdict) and the finalizer re-enters `maybeAutoRepair`.
    expect(recompute).toHaveBeenCalledWith('op-1');
    expect(finalizeVerifyRun).toHaveBeenCalledWith(db, 'u1', 'op-1', {}, undefined);
  });

  it('leaves a stale repairing claim alone while its repair child is still in flight', async () => {
    // The spawner died, but the repair child it already spawned is running —
    // that child owns the parent's settlement, so reclaiming here would race
    // it and spawn a duplicate round.
    singlePage([stuckRun({ status: 'repairing' })]);
    operationListTree.mockResolvedValue([
      { id: 'op-1', parentOperationId: null },
      { id: 'op-repair', parentOperationId: 'op-1', status: 'running' },
    ]);
    runFindByOperation.mockImplementation(async (id: string) =>
      id === 'op-repair' ? { id: 'run-repair', status: 'planned', updatedAt: NOW } : undefined,
    );

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(recompute).not.toHaveBeenCalled();
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
  });

  /** Regression (Codex r4652054496): a verifier parked on an async tool pinned a dead claim forever. */
  it('does not count an in-flight verifier of the parent as a repair in flight', async () => {
    // `agentVerifier` parents its sub-agent under the verified operation, and
    // a verifier owns no round. The repair it led to was never spawned, so the
    // claim is reclaimed rather than skipped every tick.
    singlePage([stuckRun({ acceptanceId: 'acc-1', roundIndex: 1, status: 'repairing' })]);
    operationListTree.mockResolvedValue([
      { id: 'op-1', parentOperationId: null },
      { id: 'op-verifier', parentOperationId: 'op-1', status: 'running' },
    ]);
    runFindByOperation.mockResolvedValue(undefined);
    listByAcceptance.mockResolvedValue([{ roundIndex: 1 }]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.settled).toEqual(['run-1']);
    expect(reclaimRepairing).toHaveBeenCalledWith('run-1');
    expect(finalizeVerifyRun).toHaveBeenCalledWith(db, 'u1', 'op-1', {}, undefined);
  });

  it('does not count an in-flight child with a round of another acceptance', async () => {
    singlePage([stuckRun({ acceptanceId: 'acc-1', roundIndex: 1, status: 'repairing' })]);
    operationListTree.mockResolvedValue([
      { id: 'op-1', parentOperationId: null },
      { id: 'op-other', parentOperationId: 'op-1', status: 'running' },
    ]);
    runFindByOperation.mockImplementation(async (id: string) =>
      id === 'op-other'
        ? { acceptanceId: 'acc-other', id: 'run-other', status: 'verifying', updatedAt: NOW }
        : undefined,
    );
    listByAcceptance.mockResolvedValue([{ roundIndex: 1 }]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(reclaimRepairing).toHaveBeenCalledWith('run-1');
    expect(outcome.settled).toEqual(['run-1']);
  });

  it('reclaims a stale repairing claim whose repair child already finished', async () => {
    // A terminal child stays terminal — the whole chain is dead, so the claim
    // is abandoned even though a child operation exists.
    singlePage([stuckRun({ status: 'repairing' })]);
    operationListTree.mockResolvedValue([
      { id: 'op-1', parentOperationId: null },
      { id: 'op-repair', parentOperationId: 'op-1', status: 'done' },
    ]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.settled).toEqual(['run-1']);
    expect(recompute).toHaveBeenCalledWith('op-1');
    expect(finalizeVerifyRun).toHaveBeenCalledWith(db, 'u1', 'op-1', {}, undefined);
  });

  it('keeps a stale repairing claim while its finished repair child is still being verified', async () => {
    // The repair agent is done, but its completion-triggered round is still in
    // judging: that round's finalizer will collapse this parent, so reclaiming
    // now would spawn a duplicate repair against the same failures.
    singlePage([stuckRun({ status: 'repairing' })]);
    operationListTree.mockImplementation(async (id: string) =>
      id === 'op-1'
        ? [
            { id: 'op-1', parentOperationId: null },
            { id: 'op-repair', parentOperationId: 'op-1', status: 'done' },
          ]
        : [{ id: 'op-repair', parentOperationId: 'op-1', status: 'done' }],
    );
    runFindByOperation.mockImplementation(async (id: string) =>
      id === 'op-repair' ? { id: 'run-repair', status: 'verifying', updatedAt: NOW } : undefined,
    );

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(reclaimRepairing).not.toHaveBeenCalled();
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('keeps a stale repairing claim while a verifier of its finished repair child is live', async () => {
    singlePage([stuckRun({ status: 'repairing' })]);
    operationListTree.mockImplementation(async (id: string) =>
      id === 'op-1'
        ? [
            { id: 'op-1', parentOperationId: null },
            { id: 'op-repair', parentOperationId: 'op-1', status: 'done' },
          ]
        : [
            { id: 'op-repair', parentOperationId: 'op-1', status: 'done' },
            { id: 'op-verifier', parentOperationId: 'op-repair', status: 'running' },
          ],
    );
    // The repair's own round is stale and pre-judging; only its live verifier
    // keeps the chain alive.
    runFindByOperation.mockImplementation(async (id: string) =>
      id === 'op-repair'
        ? {
            id: 'run-repair',
            status: 'planned',
            updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000),
          }
        : undefined,
    );

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(reclaimRepairing).not.toHaveBeenCalled();
  });

  it('reclaims a stale repairing claim whose finished repair child never reached judging', async () => {
    // A child round stuck in `planned` past the abandoned bound is a lost
    // completion, not a live verification — it must not pin the parent forever.
    singlePage([stuckRun({ status: 'repairing' })]);
    operationListTree.mockImplementation(async (id: string) =>
      id === 'op-1'
        ? [
            { id: 'op-1', parentOperationId: null },
            { id: 'op-repair', parentOperationId: 'op-1', status: 'done' },
          ]
        : [{ id: 'op-repair', parentOperationId: 'op-1', status: 'done' }],
    );
    runFindByOperation.mockImplementation(async (id: string) =>
      id === 'op-repair'
        ? {
            id: 'run-repair',
            status: 'planned',
            updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000),
          }
        : undefined,
    );

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.settled).toEqual(['run-1']);
    expect(finalizeVerifyRun).toHaveBeenCalledWith(db, 'u1', 'op-1', {}, undefined);
  });

  const settledChildTree = async (id: string) =>
    id === 'op-1'
      ? [
          { id: 'op-1', parentOperationId: null },
          { id: 'op-repair', parentOperationId: 'op-1', status: 'done' },
        ]
      : [{ id: 'op-repair', parentOperationId: 'op-1', status: 'done' }];

  it('keeps a stale repairing claim while its just-settled repair child is still finalizing', async () => {
    // The repair round outlived the parent's grace, then recomputed itself to
    // `failed`; its finalizer has not yet collapsed this parent. Reclaiming
    // now would finalize the original round and spawn a second repair.
    singlePage([stuckRun({ status: 'repairing' })]);
    operationListTree.mockImplementation(settledChildTree);
    runFindByOperation.mockImplementation(async (id: string) =>
      id === 'op-repair'
        ? { id: 'run-repair', status: 'failed', updatedAt: new Date(NOW.getTime() - 1000) }
        : undefined,
    );

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(reclaimRepairing).not.toHaveBeenCalled();
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
  });

  const strandedChild = (status: string, overrides?: Record<string, unknown>) => ({
    id: 'run-repair',
    status,
    updatedAt: new Date(NOW.getTime() - VERIFY_ROLLUP_GRACE_MS - 1000),
    ...overrides,
  });

  it.each(['passed', 'failed', 'errored'])(
    'finishes a %s repair child whose finalizer died instead of reclaiming its parent',
    async (status) => {
      // The child settled long ago, yet the parent is still `repairing`: the
      // child's finalizer died before collapsing it. The child is already the
      // acceptance's latest round, so reclaiming the parent would only reach a
      // suppressed finalizer and leave the task hanging — run the child's.
      singlePage([stuckRun({ acceptanceId: 'acc-1', roundIndex: 1, status: 'repairing' })]);
      operationListTree.mockImplementation(settledChildTree);
      runFindByOperation.mockImplementation(async (id: string) =>
        id === 'op-repair'
          ? strandedChild(status, { acceptanceId: 'acc-1', roundIndex: 2 })
          : undefined,
      );
      listByAcceptance.mockResolvedValue([{ roundIndex: 1 }, { roundIndex: 2 }]);

      const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

      expect(outcome.settled).toEqual(['run-1']);
      expect(finalizeVerifyRun).toHaveBeenCalledTimes(1);
      expect(finalizeVerifyRun).toHaveBeenCalledWith(db, 'u1', 'op-repair', {}, undefined);
      // The child's finalizer collapses this parent; the parent's claim stays
      // put so a child that repairs again keeps owning the chain.
      expect(reclaimRepairing).not.toHaveBeenCalled();
      expect(recompute).not.toHaveBeenCalled();
      expect(recordAutoRepair).not.toHaveBeenCalled();
    },
  );

  it('reclaims the parent when its settled repair child was itself superseded', async () => {
    // A later round already took over the acceptance: finalizing the child
    // would decline a repair that already happened, so only the parent's own
    // rollup is restored.
    singlePage([stuckRun({ acceptanceId: 'acc-1', roundIndex: 1, status: 'repairing' })]);
    operationListTree.mockImplementation(settledChildTree);
    runFindByOperation.mockImplementation(async (id: string) =>
      id === 'op-repair'
        ? strandedChild('failed', { acceptanceId: 'acc-1', roundIndex: 2 })
        : { id: 'run-1', status: 'failed' },
    );
    listByAcceptance.mockResolvedValue([{ roundIndex: 1 }, { roundIndex: 2 }, { roundIndex: 3 }]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.settled).toEqual(['run-1']);
    expect(reclaimRepairing).toHaveBeenCalledWith('run-1');
    expect(recompute).toHaveBeenCalledWith('op-1');
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('does not treat a settled child of another acceptance as the repair round', async () => {
    // Evidence/verifier children hang off the same operation; their own runs
    // are not this acceptance's rounds, so the claim is reclaimed as before.
    singlePage([stuckRun({ acceptanceId: 'acc-1', roundIndex: 1, status: 'repairing' })]);
    operationListTree.mockImplementation(settledChildTree);
    runFindByOperation.mockImplementation(async (id: string) =>
      id === 'op-repair' ? strandedChild('passed', { acceptanceId: 'acc-other' }) : undefined,
    );
    listByAcceptance.mockResolvedValue([{ roundIndex: 1 }]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.settled).toEqual(['run-1']);
    expect(reclaimRepairing).toHaveBeenCalledWith('run-1');
    expect(finalizeVerifyRun).toHaveBeenCalledWith(db, 'u1', 'op-1', {}, undefined);
  });

  describe('a finished repair whose round never reached judging', () => {
    /** A repair round of the same acceptance, confirmed, stale past the abandoned bound. */
    const preJudgingChild = (status: string, overrides?: Record<string, unknown>) => ({
      acceptanceId: 'acc-1',
      goal: 'Ship the fix',
      id: 'run-repair',
      plan: [{ id: 'c1', required: true }],
      planConfirmedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 5000),
      roundIndex: 2,
      status,
      updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000),
      ...overrides,
    });

    beforeEach(() => {
      singlePage([stuckRun({ acceptanceId: 'acc-1', roundIndex: 1, status: 'repairing' })]);
      operationListTree.mockImplementation(settledChildTree);
      operationFindById.mockResolvedValue({ id: 'op-repair', topicId: 'tpc-1' });
      findVerifyMessageByOperationId.mockResolvedValue({ parentId: 'msg-reply' });
      messageFindById.mockResolvedValue({ content: 'Fixed the failing check.' });
      listByAcceptance.mockResolvedValue([{ roundIndex: 1 }, { roundIndex: 2 }]);
    });

    /**
     * Regression (Codex #4651522050): the repair op is `done` but its completion
     * hook died with the child round still `planned`. Reclaiming the parent only
     * reached a suppressed finalizer, and nothing sweeps that child — the
     * acceptance and task hung for good.
     */
    it('re-runs the completion gate of a planned child instead of reclaiming its parent', async () => {
      runFindByOperation.mockImplementation(async (id: string) =>
        id === 'op-repair' ? preJudgingChild('planned') : undefined,
      );

      const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

      expect(outcome.redriven).toEqual(['run-1']);
      expect(runVerifyOnCompletion).toHaveBeenCalledWith(
        db,
        'u1',
        {
          deliverable: 'Fixed the failing check.',
          goal: 'Ship the fix',
          operationId: 'op-repair',
        },
        undefined,
      );
      expect(findVerifyMessageByOperationId).toHaveBeenCalledWith('op-repair', 'tpc-1');
      expect(runVerifyAfterEvidenceSubmission).not.toHaveBeenCalled();
      expect(reclaimRepairing).not.toHaveBeenCalled();
      expect(finalizeVerifyRun).not.toHaveBeenCalled();
    });

    /**
     * Regression (Codex r4652081198): completion marked the repair `done` and
     * died before writing the verify card, so the child was judged on an empty
     * delivery.
     */
    it("judges the run's own final reply when completion died before the verify card", async () => {
      runFindByOperation.mockImplementation(async (id: string) =>
        id === 'op-repair' ? preJudgingChild('planned') : undefined,
      );
      findVerifyMessageByOperationId.mockResolvedValue(undefined);
      findLatestAssistantByOperationId.mockResolvedValue({
        content: 'Fixed it without a card.',
        id: 'msg-own',
        role: 'assistant',
      });

      await sweepStuckVerifyRuns(db, { now: NOW });

      expect(findLatestAssistantByOperationId).toHaveBeenCalledWith({
        operationId: 'op-repair',
        topicId: 'tpc-1',
      });
      expect(runVerifyOnCompletion).toHaveBeenCalledWith(
        db,
        'u1',
        expect.objectContaining({ deliverable: 'Fixed it without a card.' }),
        undefined,
      );
    });

    it('judges a child whose evidence turn died in collecting_evidence', async () => {
      runFindByOperation.mockImplementation(async (id: string) =>
        id === 'op-repair' ? preJudgingChild('collecting_evidence') : undefined,
      );

      const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

      expect(outcome.redriven).toEqual(['run-1']);
      expect(runVerifyAfterEvidenceSubmission).toHaveBeenCalledWith(
        db,
        'u1',
        expect.objectContaining({ operationId: 'op-repair' }),
        undefined,
      );
      expect(runVerifyOnCompletion).not.toHaveBeenCalled();
      expect(reclaimRepairing).not.toHaveBeenCalled();
    });

    it('reclaims the parent when the planned child was superseded', async () => {
      runFindByOperation.mockImplementation(async (id: string) =>
        id === 'op-repair' ? preJudgingChild('planned') : { id: 'run-1', status: 'failed' },
      );
      listByAcceptance.mockResolvedValue([{ roundIndex: 1 }, { roundIndex: 2 }, { roundIndex: 3 }]);

      const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

      expect(outcome.settled).toEqual(['run-1']);
      expect(runVerifyOnCompletion).not.toHaveBeenCalled();
      expect(reclaimRepairing).toHaveBeenCalledWith('run-1');
    });

    it('leaves a planned child of a repair that did not finish to its own sweep path', async () => {
      operationListTree.mockImplementation(async (id: string) =>
        id === 'op-1'
          ? [
              { id: 'op-1', parentOperationId: null },
              { id: 'op-repair', parentOperationId: 'op-1', status: 'error' },
            ]
          : [{ id: 'op-repair', parentOperationId: 'op-1', status: 'error' }],
      );
      runFindByOperation.mockImplementation(async (id: string) =>
        id === 'op-repair' ? preJudgingChild('planned') : { id: 'run-1', status: 'failed' },
      );

      await sweepStuckVerifyRuns(db, { now: NOW });

      expect(runVerifyOnCompletion).not.toHaveBeenCalled();
      expect(reclaimRepairing).toHaveBeenCalledWith('run-1');
    });
  });

  it('reclaims a superseded stale repairing claim without driving its task', async () => {
    // A later round of the same acceptance now owns the task: the reclaimed
    // round only gets its rollup, like every other sweep path.
    singlePage([stuckRun({ acceptanceId: 'acc-1', roundIndex: 1, status: 'repairing' })]);
    operationListTree.mockResolvedValue([{ id: 'op-1', parentOperationId: null }]);
    listByAcceptance.mockResolvedValue([{ roundIndex: 1 }, { roundIndex: 2 }]);
    runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.settled).toEqual(['run-1']);
    expect(recompute).toHaveBeenCalledWith('op-1');
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
    // The finalizer's superseded branch is skipped, so the sweep records the
    // declined outcome itself — otherwise the card reads it as awaiting repair.
    expect(recordAutoRepair).toHaveBeenCalledWith('run-1', 'declined');
  });

  it('drops a stale repairing claim another delivery already reclaimed', async () => {
    singlePage([stuckRun({ status: 'repairing' })]);
    operationListTree.mockResolvedValue([{ id: 'op-1', parentOperationId: null }]);
    reclaimRepairing.mockResolvedValue(false);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(recompute).not.toHaveBeenCalled();
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
  });
});
