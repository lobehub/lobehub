// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VERIFY_ABANDONED_MS, VERIFY_ROLLUP_GRACE_MS } from '../staleness';
import { SWEEP_MAX_JUDGING_RUNS, sweepStuckVerifyRuns } from '../sweep';

const {
  settleFailedRepair,
  claimVerifying,
  claimVerifyingByRunId,
  restoreEvidenceCollection,
  reopenForFinalizeRetry,
  createVerifierAgentRunner,
  executorExecute,
  findStuckVerifying,
  findStuckCollectingEvidence,
  listOperationTree,
  loadAgentState,
  operationFindById,
  recordHeterogeneousDeliverableEvidence,
  resolveTaskAcceptance,
  resolveVerifyModelConfig,
  resolveVerificationDeliverable,
  recompute,
  recomputeByRunId,
  evidenceListByRun,
  resultListByRun,
  upsertByCheckItem,
  finalizeVerifyRun,
} = vi.hoisted(() => ({
  settleFailedRepair: vi.fn(),
  claimVerifying: vi.fn(),
  claimVerifyingByRunId: vi.fn(),
  restoreEvidenceCollection: vi.fn(),
  reopenForFinalizeRetry: vi.fn(),
  createVerifierAgentRunner: vi.fn(),
  executorExecute: vi.fn(),
  finalizeVerifyRun: vi.fn(),
  findStuckVerifying: vi.fn(),
  findStuckCollectingEvidence: vi.fn(),
  listOperationTree: vi.fn(),
  loadAgentState: vi.fn(),
  operationFindById: vi.fn(),
  recordHeterogeneousDeliverableEvidence: vi.fn(),
  resolveTaskAcceptance: vi.fn(),
  resolveVerifyModelConfig: vi.fn(),
  resolveVerificationDeliverable: vi.fn(),
  recompute: vi.fn(),
  recomputeByRunId: vi.fn(),
  evidenceListByRun: vi.fn(),
  resultListByRun: vi.fn(),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: Object.assign(
    vi.fn(function () {
      return {};
    }),
    { findStuckVerifying, findStuckCollectingEvidence },
  ),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun: resultListByRun, upsertByCheckItem };
  }),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return { listByRun: evidenceListByRun };
  }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: operationFindById, listOperationTree };
  }),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(function () {
    return {
      claimVerifying,
      claimVerifyingByRunId,
      recompute,
      recomputeByRunId,
      restoreEvidenceCollection,
      reopenForFinalizeRetry,
    };
  }),
}));
vi.mock('../repairTerminal', () => ({ settleFailedRepair }));
vi.mock('../settle', () => ({ finalizeVerifyRun }));
vi.mock('../evidenceSubmission', () => ({
  EVIDENCE_HOOK_ID: 'acceptance-evidence-on-complete',
  recordHeterogeneousDeliverableEvidence,
}));
vi.mock('../executor', () => ({
  VerifyExecutorService: vi.fn(function () {
    return { execute: executorExecute };
  }),
}));
vi.mock('../lifecycle', () => ({ resolveVerificationDeliverable }));
vi.mock('../modelConfig', () => ({ resolveVerifyModelConfig }));
vi.mock('../taskAcceptance', () => ({ resolveTaskAcceptance }));
vi.mock('../agentVerifier', () => ({ createVerifierAgentRunner }));
vi.mock('@/server/modules/AgentRuntime', () => ({
  createAgentStateManager: () => ({ loadAgentState }),
}));

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

beforeEach(() => {
  [
    settleFailedRepair,
    claimVerifying,
    claimVerifyingByRunId,
    restoreEvidenceCollection,
    reopenForFinalizeRetry,
    createVerifierAgentRunner,
    executorExecute,
    finalizeVerifyRun,
    findStuckVerifying,
    findStuckCollectingEvidence,
    listOperationTree,
    loadAgentState,
    operationFindById,
    recordHeterogeneousDeliverableEvidence,
    resolveTaskAcceptance,
    resolveVerifyModelConfig,
    resolveVerificationDeliverable,
    recompute,
    recomputeByRunId,
    evidenceListByRun,
    resultListByRun,
    upsertByCheckItem,
  ].forEach((m) => m.mockReset());
  findStuckVerifying.mockResolvedValue([]);
  findStuckCollectingEvidence.mockResolvedValue([]);
  resultListByRun.mockResolvedValue([]);
  // No evidence rows by default: a run with result rows but nothing behind them is
  // a collector that died before it submitted, not a partial submission.
  evidenceListByRun.mockResolvedValue([]);
  claimVerifying.mockResolvedValue(true);
  claimVerifyingByRunId.mockResolvedValue(true);
  executorExecute.mockResolvedValue(undefined);
  resolveVerifyModelConfig.mockResolvedValue({ model: 'gpt-4o', provider: 'openai' });
  resolveVerificationDeliverable.mockImplementation(
    async (_db: unknown, _userId: unknown, deliverable: string) => deliverable,
  );
  createVerifierAgentRunner.mockReturnValue(async () => null);
  operationFindById.mockResolvedValue({
    id: 'op-1',
    model: 'claude-code',
    provider: 'heterogeneous',
    status: 'done',
    taskId: null,
  });
});

describe('sweepStuckVerifyRuns', () => {
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
    expect(recomputeByRunId).toHaveBeenCalledWith('run-1');
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
    expect(recomputeByRunId).not.toHaveBeenCalled();
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
    expect(recomputeByRunId).toHaveBeenCalledWith('run-1');
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
    expect(recomputeByRunId).not.toHaveBeenCalled();
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
    expect(recomputeByRunId).toHaveBeenCalledWith('run-1');
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
    expect(recomputeByRunId).not.toHaveBeenCalled();
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

  it('recovers a planned repair whose operation died before judging began', async () => {
    singlePage([stuckRun({ status: 'planned' })]);
    settleFailedRepair.mockResolvedValue(true);
    expect((await sweepStuckVerifyRuns(db, { now: NOW })).abandoned).toEqual(['run-1']);
    expect(settleFailedRepair).toHaveBeenCalledWith(db, 'u1', 'op-1', undefined);
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
  });
});

describe('sweepStuckVerifyRuns — collecting_evidence', () => {
  /** A run the evidence turn stranded: no rows submitted, op terminal. */
  const evidenceRun = (overrides?: Partial<Record<string, unknown>>) => ({
    id: 'ev-run-1',
    operationId: 'op-1',
    plan: [{ id: 'c1', required: true }],
    updatedAt: new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000),
    userId: 'u1',
    workspaceId: null,
    ...overrides,
  });

  const singleEvidencePage = (runs: unknown[]) => {
    findStuckCollectingEvidence.mockResolvedValueOnce(runs).mockResolvedValue([]);
  };

  const deadOps = () => [
    { id: 'op-1', parentOperationId: null, status: 'done' },
    { id: 'op-1-evidence', parentOperationId: 'op-1', status: 'error' },
  ];

  /** The evidence hook body `loadAgentState` returns for the continuation op. */
  const evidenceHookState = (deliverable: string | null) => ({
    host: {
      hooks: [
        {
          id: 'acceptance-evidence-on-complete',
          type: 'onComplete',
          webhook: {
            url: '/api/workflows/verify/on-evidence-complete',
            body: { deliverable },
          },
        },
      ],
    },
  });

  beforeEach(() => {
    listOperationTree.mockResolvedValue(deadOps());
    // The dead continuation carries the evidence hook by default.
    loadAgentState.mockImplementation(async (operationId: string) =>
      operationId === 'op-1-evidence' ? evidenceHookState('final patch text') : null,
    );
  });

  it('scans collecting_evidence runs at the abandoned bound', async () => {
    await sweepStuckVerifyRuns(db, { now: NOW });

    expect(findStuckCollectingEvidence).toHaveBeenCalledWith(
      db,
      new Date(NOW.getTime() - VERIFY_ABANDONED_MS),
      expect.objectContaining({ after: undefined }),
    );
  });

  it('backfills the deliverable as inline evidence and judges', async () => {
    singleEvidencePage([evidenceRun()]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(recordHeterogeneousDeliverableEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ deliverable: 'final patch text', userId: 'u1' }),
    );
    expect(upsertByCheckItem).not.toHaveBeenCalled();
    expect(outcome.evidenceRecovered).toEqual(['ev-run-1']);
    // The sweep runs a real judge pass — the mirror of the lifecycle's normal
    // completion path — not just the finalizer.
    expect(executorExecute).toHaveBeenCalledWith(
      expect.objectContaining({ deliverable: 'final patch text', goal: '', operationId: 'op-1' }),
    );
    // A recovered judge holds the deliverable and model config, so it must
    // finalize with the same report context the inline lifecycle passes — the
    // empty `{}` would drive the task but never create the report card.
    expect(finalizeVerifyRun).toHaveBeenCalledWith(
      db,
      'u1',
      'op-1',
      {
        report: {
          deliverable: 'final patch text',
          goal: '',
          modelConfig: { model: 'gpt-4o', provider: 'openai' },
        },
      },
      undefined,
    );
    // The executor and the finalizer both address the round by operation, and both
    // return silently if it is deleted mid-judge — so the recovered verdict must
    // also land through the run id, or the run would stay leased in `verifying`
    // with no error to fall back on.
    expect(recomputeByRunId).toHaveBeenCalledWith('ev-run-1');
  });

  // Each recovery is a full judge pass run inside the cron request; an
  // unbounded tick would hold it open for hundreds of LLM calls.
  it('caps the judge passes one tick runs inline and leaves the rest unclaimed', async () => {
    const runs = Array.from({ length: SWEEP_MAX_JUDGING_RUNS + 2 }, (_, index) =>
      evidenceRun({ id: `ev-run-${index}` }),
    );
    singleEvidencePage(runs);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(SWEEP_MAX_JUDGING_RUNS).toBeLessThanOrEqual(5);
    expect(executorExecute).toHaveBeenCalledTimes(SWEEP_MAX_JUDGING_RUNS);
    expect(claimVerifying).toHaveBeenCalledTimes(SWEEP_MAX_JUDGING_RUNS);
    expect(outcome.evidenceRecovered).toHaveLength(SWEEP_MAX_JUDGING_RUNS);
    expect(outcome.skipped).toBe(2);
  });

  it('identifies the continuation by the evidence hook, not child order', async () => {
    // A builder that spawned a sub-agent earlier has another child first in the
    // tree; only the child carrying the evidence hook is the collector.
    singleEvidencePage([evidenceRun()]);
    listOperationTree.mockResolvedValue([
      { id: 'op-1', parentOperationId: null, status: 'done' },
      { id: 'op-1-subagent', parentOperationId: 'op-1', status: 'done' },
      { id: 'op-1-evidence', parentOperationId: 'op-1', status: 'error' },
    ]);
    loadAgentState.mockImplementation(async (operationId: string) => {
      if (operationId === 'op-1-evidence') return evidenceHookState('final patch text');
      // The unrelated sub-agent has state but no evidence hook.
      if (operationId === 'op-1-subagent')
        return { host: { hooks: [{ id: 'some-other-hook', type: 'onComplete' }] } };
      return null;
    });

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(loadAgentState).toHaveBeenCalledWith('op-1-subagent');
    expect(loadAgentState).toHaveBeenCalledWith('op-1-evidence');
    expect(recordHeterogeneousDeliverableEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ deliverable: 'final patch text' }),
    );
    expect(outcome.evidenceRecovered).toEqual(['ev-run-1']);
  });

  it('skips a run whose only child state cannot be read while it may be live', async () => {
    // Redis down: the child might be the collector mid-flight. A claim here
    // could steal the ending of a live collector, so the run is hands-off.
    singleEvidencePage([evidenceRun()]);
    loadAgentState.mockRejectedValue(new Error('Redis is required'));

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(claimVerifying).not.toHaveBeenCalled();
    expect(upsertByCheckItem).not.toHaveBeenCalled();
  });

  it('skips a live child whose state has expired instead of claiming its run', async () => {
    // A step that outlives the state TTL refreshes its operation lease (its
    // heartbeat) but not the state blob, so the child reads as state-less while it
    // is still running. Its worker keeps the hook in memory and may still report
    // valid evidence, so the run must stay hands-off rather than be judged away.
    singleEvidencePage([evidenceRun()]);
    listOperationTree.mockResolvedValue([
      { id: 'op-1', parentOperationId: null, status: 'done' },
      { id: 'op-1-evidence', parentOperationId: 'op-1', status: 'running' },
    ]);
    loadAgentState.mockResolvedValue(null);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(claimVerifying).not.toHaveBeenCalled();
    expect(upsertByCheckItem).not.toHaveBeenCalled();
  });

  it('reads the evidence hook state from the evidence child operation', async () => {
    // `execAgent` persists the evidence hooks onto the continuation run's own
    // runtime state — the builder's state key holds none.
    singleEvidencePage([evidenceRun()]);
    loadAgentState.mockImplementation(async (operationId: string) =>
      operationId === 'op-1-evidence' ? evidenceHookState('child state text') : null,
    );

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(loadAgentState).toHaveBeenCalledWith('op-1-evidence');
    expect(recordHeterogeneousDeliverableEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ deliverable: 'child state text' }),
    );
    expect(outcome.evidenceRecovered).toEqual(['ev-run-1']);
  });

  it('skips a run whose evidence turn is still live', async () => {
    singleEvidencePage([evidenceRun()]);
    listOperationTree.mockResolvedValue([
      { id: 'op-1', parentOperationId: null, status: 'done' },
      { id: 'op-1-evidence', parentOperationId: 'op-1', status: 'running' },
    ]);
    loadAgentState.mockImplementation(async (operationId: string) =>
      operationId === 'op-1-evidence' ? evidenceHookState('final patch text') : null,
    );

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(recordHeterogeneousDeliverableEvidence).not.toHaveBeenCalled();
    expect(claimVerifying).not.toHaveBeenCalled();
  });

  it('skips a run with partial evidence whose collector is still live', async () => {
    // The claim inside the partial-evidence branch must not steal the ending
    // from a collector that can still submit the rest of the plan.
    singleEvidencePage([evidenceRun()]);
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'pending', verdict: null }]);
    listOperationTree.mockResolvedValue([
      { id: 'op-1', parentOperationId: null, status: 'done' },
      { id: 'op-1-evidence', parentOperationId: 'op-1', status: 'waiting_for_async_tool' },
    ]);
    loadAgentState.mockImplementation(async (operationId: string) =>
      operationId === 'op-1-evidence' ? evidenceHookState('final patch text') : null,
    );

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(outcome.skipped).toBe(1);
    expect(claimVerifying).not.toHaveBeenCalled();
    expect(executorExecute).not.toHaveBeenCalled();
  });

  it('judges partial evidence against the frozen deliverable, not an empty string', async () => {
    // A collector that died after submitting some criteria: the verdicts must
    // still be rendered against the real final output — an empty deliverable
    // would pass the structural gate on uncovered criteria and invent verdicts.
    singleEvidencePage([evidenceRun()]);
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'pending', verdict: null }]);
    evidenceListByRun.mockResolvedValue([{ checkItemId: 'c1', evidence: [] }]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(executorExecute).toHaveBeenCalledWith(
      expect.objectContaining({ deliverable: 'final patch text', operationId: 'op-1' }),
    );
    // No backfill: the criteria the dead collector never reached must stay
    // structurally uncovered, or the deliverable would make them look evidenced.
    expect(recordHeterogeneousDeliverableEvidence).not.toHaveBeenCalled();
    expect(outcome.settled).toEqual(['ev-run-1']);
  });

  it('judges instead of backfilling when evidence rows already exist', async () => {
    singleEvidencePage([evidenceRun()]);
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'pending', verdict: null }]);
    evidenceListByRun.mockResolvedValue([{ checkItemId: 'c1', evidence: [] }]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(executorExecute).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op-1' }));
    expect(recordHeterogeneousDeliverableEvidence).not.toHaveBeenCalled();
    expect(outcome.settled).toEqual(['ev-run-1']);
  });

  it('backfills when the collector left a result row but no evidence', async () => {
    // `acceptanceEvidence` upserts the result row first and inserts the evidence
    // after, so a crash in between leaves a row with nothing behind it. That is not
    // a partial submission: the criteria still need the frozen deliverable, and
    // treating the row as evidence would leave them `uncertain`.
    singleEvidencePage([evidenceRun()]);
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'pending', verdict: null }]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(recordHeterogeneousDeliverableEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ deliverable: 'final patch text' }),
    );
    expect(outcome.evidenceRecovered).toEqual(['ev-run-1']);
  });

  it('backfills the evidence only after winning the recovery lease', async () => {
    // An overlapping sweep that reaches the insert before its claim must not
    // duplicate the evidence rows against the winner's — `createMany` is an
    // unconstrained insert, so the write follows the claim.
    singleEvidencePage([evidenceRun()]);
    claimVerifying.mockResolvedValue(false);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(recordHeterogeneousDeliverableEvidence).not.toHaveBeenCalled();
    expect(outcome.skipped).toBe(1);
  });

  it('closes the outstanding checks as errored when the agent state is gone', async () => {
    singleEvidencePage([evidenceRun()]);
    loadAgentState.mockResolvedValue(null);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(recordHeterogeneousDeliverableEvidence).not.toHaveBeenCalled();
    expect(upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({ checkItemId: 'c1', status: 'errored', verifyRunId: 'ev-run-1' }),
    );
    // Settled by run id: the operation-addressed rollup could not resolve this
    // run if its Agent Run had been deleted.
    expect(recomputeByRunId).toHaveBeenCalledWith('ev-run-1');
    expect(outcome.abandoned).toEqual(['ev-run-1']);
  });

  it('closes the outstanding checks as errored when the state has no deliverable', async () => {
    // The hook survived but its body holds no deliverable — judging without it
    // would invent verdicts, so the errored-rows ending applies here too.
    singleEvidencePage([evidenceRun()]);
    loadAgentState.mockImplementation(async (operationId: string) =>
      operationId === 'op-1-evidence' ? evidenceHookState(null) : null,
    );

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(executorExecute).not.toHaveBeenCalled();
    expect(upsertByCheckItem).toHaveBeenCalledWith(expect.objectContaining({ status: 'errored' }));
    expect(outcome.abandoned).toEqual(['ev-run-1']);
  });

  it('settles by run id when the operation vanishes after the lease is won', async () => {
    // The op row can be deleted between `enterJudging` winning `claimVerifying`
    // and the lookup that resolves the verifier. The FK then clears
    // `verify_runs.operation_id`, so an operation-addressed close would re-claim
    // the lease it just took (always losing) while the now operation-less run is
    // invisible to the sweep — stranded in `verifying` forever.
    singleEvidencePage([evidenceRun()]);
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'pending', verdict: null }]);
    operationFindById.mockResolvedValue(null);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    // The lease already won by `enterJudging` is reused, not re-acquired.
    expect(claimVerifying).toHaveBeenCalledTimes(1);
    expect(recordHeterogeneousDeliverableEvidence).not.toHaveBeenCalled();
    expect(executorExecute).not.toHaveBeenCalled();
    // The closed rows carry no dangling operation link.
    expect(upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({
        checkItemId: 'c1',
        operationId: null,
        status: 'errored',
        verifyRunId: 'ev-run-1',
      }),
    );
    expect(recomputeByRunId).toHaveBeenCalledWith('ev-run-1');
    // Nothing left to drive once the operation is gone.
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
    // The checks were closed as `errored`, so this is an abandonment — not a
    // recovery — whatever the run's entry action was.
    expect(outcome.abandoned).toEqual(['ev-run-1']);
  });

  it('bounds the whole tick across both scans', async () => {
    // `maxRuns` bounds the tick, not each scan: the two scans split it, so a
    // backlog cannot make the cron do two full allowances of work (and hold the
    // request open for it).
    const aged = new Date(NOW.getTime() - VERIFY_ABANDONED_MS - 1000);
    findStuckVerifying
      .mockResolvedValueOnce([
        stuckRun({ id: 'v-1', operationId: 'op-v1', updatedAt: aged }),
        stuckRun({ id: 'v-2', operationId: 'op-v2', updatedAt: aged }),
      ])
      .mockResolvedValue([]);
    singleEvidencePage([evidenceRun({ id: 'e-1' }), evidenceRun({ id: 'e-2' })]);
    resultListByRun.mockResolvedValue([]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW, maxRuns: 2 });

    expect(outcome.abandoned).toEqual(['v-1']);
    expect(outcome.evidenceRecovered).toEqual(['e-1']);
  });

  it('still runs the evidence scan when untouchable verifying rows saturate the tick', async () => {
    // Untouchable rows (here: rounds whose repair never lands) keep their
    // timestamp and head the ordered scan again on every tick. Sharing one
    // counter would let them consume the whole allowance forever, so the
    // evidence scan would never run and its runs would strand for good.
    findStuckVerifying
      .mockResolvedValueOnce(
        Array.from({ length: 6 }, (_, index) =>
          stuckRun({ id: `v-${index}`, operationId: `op-v${index}`, status: 'planned' }),
        ),
      )
      .mockResolvedValue([]);
    settleFailedRepair.mockResolvedValue(false); // every one is left alone
    singleEvidencePage([evidenceRun()]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW, maxRuns: 2 });

    // The verifying scan spends its whole share on rows it cannot touch …
    expect(outcome.skipped).toBe(1);
    // … and the evidence scan still gets its own share.
    expect(outcome.evidenceRecovered).toEqual(['ev-run-1']);
  });

  it('closes an evidence run whose builder operation was deleted before selection', async () => {
    // The FK clears `operation_id` when the Agent Run is deleted, so the run can
    // surface with no operation at all. There is no state to read a deliverable
    // from — but it must still be settled by run id, or its acceptance stays
    // blocked forever.
    singleEvidencePage([evidenceRun({ operationId: null })]);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    // Nothing to claim by operation; the run itself is claimed instead.
    expect(claimVerifying).not.toHaveBeenCalled();
    expect(claimVerifyingByRunId).toHaveBeenCalledWith('ev-run-1', expect.any(Date));
    expect(upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({ checkItemId: 'c1', operationId: null, status: 'errored' }),
    );
    expect(recomputeByRunId).toHaveBeenCalledWith('ev-run-1');
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
    expect(outcome.abandoned).toEqual(['ev-run-1']);
  });

  it('settles by run id when the builder vanishes after the lookup', async () => {
    // The operation can be deleted *between* the lookup and the judging work.
    // The FK then nulls the run's link, so the backfill can no longer resolve it
    // and throws while the run we hold stays leased in `verifying` — invisible to
    // the next sweep's operation-scoped scan.
    singleEvidencePage([evidenceRun()]);
    // First call is `enterJudging`'s lookup (the operation is still there); the
    // second is the post-failure check that finds it gone.
    operationFindById
      .mockResolvedValueOnce({
        id: 'op-1',
        model: 'claude-code',
        provider: 'heterogeneous',
        status: 'done',
        taskId: null,
      })
      .mockResolvedValueOnce(null);
    recordHeterogeneousDeliverableEvidence.mockRejectedValueOnce(
      new Error('Verification run is missing for heterogeneous evidence'),
    );

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    // The lease won by `enterJudging` is reused, not re-acquired.
    expect(claimVerifying).toHaveBeenCalledTimes(1);
    expect(upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({
        checkItemId: 'c1',
        operationId: null,
        status: 'errored',
        verifyRunId: 'ev-run-1',
      }),
    );
    expect(recomputeByRunId).toHaveBeenCalledWith('ev-run-1');
    expect(outcome.abandoned).toEqual(['ev-run-1']);
    // The deletion path settles; it does not hand the run back for a retry.
    expect(restoreEvidenceCollection).not.toHaveBeenCalled();
  });

  it('hands a transiently failed recovery back to the evidence scan', async () => {
    // Winning the claim moved the run out of `collecting_evidence`, and only the
    // evidence scan can retry the judge. The failure must restore that state
    // rather than leave the run in `verifying`, where the verifying half would
    // eventually close its checks `errored` and lose the recovered evidence.
    singleEvidencePage([evidenceRun()]);
    recordHeterogeneousDeliverableEvidence.mockRejectedValueOnce(new Error('transient boom'));

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(restoreEvidenceCollection).toHaveBeenCalledWith('ev-run-1');
    expect(upsertByCheckItem).not.toHaveBeenCalled();
    expect(recomputeByRunId).not.toHaveBeenCalled();
    expect(outcome.abandoned).toEqual([]);
    // Still reported, so the tick surfaces the failure.
    expect(outcome.skipped).toBe(1);
  });

  it('parks a settled run for a finalizer retry instead of re-judging it', async () => {
    // The verdicts stand, so re-entering evidence collection would re-run terminal
    // checks — overwriting verdicts, re-billing the model, and possibly spawning a
    // second repair. But a terminal run is invisible to every scan, so the failed
    // finalizer (report, repair, task drive) would never run again either. The run
    // is parked in `verifying`, where the verifying half retries exactly that.
    singleEvidencePage([evidenceRun()]);
    finalizeVerifyRun.mockRejectedValueOnce(new Error('report write failed'));

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(executorExecute).toHaveBeenCalled();
    expect(recomputeByRunId).toHaveBeenCalledWith('ev-run-1');
    expect(reopenForFinalizeRetry).toHaveBeenCalledWith('ev-run-1');
    expect(restoreEvidenceCollection).not.toHaveBeenCalled();
    // The failure still surfaces to the tick.
    expect(outcome.skipped).toBe(1);
  });

  it('does not hand a run back once the judge pass persisted a verdict', async () => {
    // The executor only *creates* the rows a check is missing — it re-judges
    // whatever already has one — so re-entering evidence collection would overwrite
    // verdicts, bill the model a second time, and can spawn a duplicate verifier.
    singleEvidencePage([evidenceRun()]);
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'passed', verdict: 'passed' }]);
    executorExecute.mockRejectedValueOnce(new Error('judge blew up mid-pass'));

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(restoreEvidenceCollection).not.toHaveBeenCalled();
    // The verdict that landed is preserved — nothing is re-closed over it.
    expect(upsertByCheckItem).not.toHaveBeenCalled();
    expect(outcome.abandoned).toEqual(['ev-run-1']);
  });

  it('retries the close without the operation link when the FK rejects it', async () => {
    // The operation can be deleted between the claim and these writes. The FK then
    // rejects the captured link, and without a retry the exception would leave the
    // run leased in `verifying` with its link cleared — invisible to both scans.
    singleEvidencePage([evidenceRun()]);
    loadAgentState.mockResolvedValue(null);
    upsertByCheckItem
      .mockRejectedValueOnce(new Error('insert or update violates foreign key constraint'))
      .mockResolvedValue(undefined);

    const outcome = await sweepStuckVerifyRuns(db, { now: NOW });

    expect(upsertByCheckItem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ operationId: 'op-1' }),
    );
    expect(upsertByCheckItem).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ operationId: null, status: 'errored', verifyRunId: 'ev-run-1' }),
    );
    expect(outcome.abandoned).toEqual(['ev-run-1']);
  });
});
