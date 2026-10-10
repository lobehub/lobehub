import type { VerifyCheckItem } from '@lobechat/types';
import { isAgentOperationInFlight } from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { AgentOperationItem } from '@/database/schemas/agentOperations';
import type { VerifyRunItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { createAgentStateManager } from '@/server/modules/AgentRuntime';

import { createVerifierAgentRunner } from './agentVerifier';
import { EVIDENCE_HOOK_ID, recordHeterogeneousDeliverableEvidence } from './evidenceSubmission';
import { VerifyExecutorService } from './executor';
import { resolveVerificationDeliverable } from './lifecycle';
import { resolveVerifyModelConfig } from './modelConfig';
import { settleFailedRepair } from './repairTerminal';
import { planItemToPendingResult } from './resultSnapshot';
import { finalizeVerifyRun } from './settle';
import { VERIFY_ABANDONED_MS, VERIFY_ROLLUP_GRACE_MS } from './staleness';
import { VerifyStatusService } from './statusService';
import { resolveTaskAcceptance } from './taskAcceptance';

const log = debug('lobe-server:verify-sweep');

const PENDING_RESULT_STATUSES = new Set(['pending', 'running']);

const SWEEP_PAGE_SIZE = 100;
/** Bound one tick's work; whatever is left is still there on the next one. */
const SWEEP_MAX_RUNS = 1000;
/**
 * Bound the judge passes one tick runs inline. A recovered evidence run is a
 * full verifier execution (LLM calls, possibly a verifier sub-agent), and the
 * sweep runs them inside the cron request one after another — at the run cap
 * that would hold the request open far past any platform timeout and leave
 * leased runs half-judged when it is killed. Runs over the budget are left
 * unclaimed, so the next tick picks them up.
 */
export const SWEEP_MAX_JUDGING_RUNS = 3;

export interface VerifySweepOutcome {
  /** Runs whose outstanding checks were closed as `errored` before the rollup. */
  abandoned: string[];
  /** Runs whose lost evidence turn was backfilled inline and judged anyway. */
  evidenceRecovered: string[];
  /** Runs whose checks had all landed and only needed the missing rollup. */
  settled: string[];
  /** Runs left alone — still plausibly mid-flight. */
  skipped: number;
}

/**
 * Recover verification runs stranded in `verifying` or `collecting_evidence`,
 * and planned repairs whose operation has already failed or been interrupted.
 *
 * Entering either state is a durable write; the work that leaves it runs as
 * post-response or child-run work, so any host-level interruption — instance
 * recycled, deploy, OOM, provider hang, a lost terminal hook — strands the run.
 * Nothing downstream re-reads it: the rollup is denormalized, the read paths
 * trust it, and the task watchdog only looks at tasks carrying a heartbeat
 * timeout. Without this sweep such a run is stuck for good, and so is the
 * acceptance and goal card above it.
 *
 * Three shapes, deliberately treated differently:
 *
 * - **the rollup was lost** (`verifying`) — every required check already holds
 *   a terminal verdict, so the truth is on disk and only the denormalized
 *   status disagrees. Recomputing is pure derivation; the only reason to wait
 *   out {@link VERIFY_ROLLUP_GRACE_MS} first is to stay clear of a live
 *   finalizer.
 * - **the verifier died mid-flight** (`verifying`) — checks are still
 *   pending/running. Those carry no verdict and never will, so after
 *   {@link VERIFY_ABANDONED_MS} they are closed as `errored` (an infra
 *   failure, not a delivery judgment, so they neither gate delivery nor seed
 *   auto-repair) and the rollup follows.
 * - **the evidence turn was lost** (`collecting_evidence`) — the evidence-only
 *   continuation died or its terminal hook was lost before it submitted
 *   anything. Unlike a dead verifier this is recoverable without re-running
 *   anything: the builder's final deliverable is already on the operation, and
 *   `recordHeterogeneousDeliverableEvidence` backfills it as inline evidence
 *   for every criterion — exactly what a heterogeneous builder would have
 *   submitted. Judging then proceeds on real deliverable text instead of
 *   manufacturing `errored` rows. Skipped when the evidence op is still live
 *   or when it has already submitted partial evidence (a live turn may yet
 *   finish, and partial evidence deserves a real judge pass, not a backfill).
 *
 * A check bound to a verifier operation that is still live keeps the whole run
 * out of the sweep however old it is — an agent verifier is a full sub-agent
 * run and its own terminal hook is what settles it.
 *
 * Recovery is leased per run (see {@link recoverRun}) so overlapping deliveries
 * of the cron cannot both drive the same run's finalizer.
 */
export const sweepStuckVerifyRuns = async (
  db: LobeChatDatabase,
  options?: { now?: Date; pageSize?: number; maxRuns?: number },
): Promise<VerifySweepOutcome> => {
  const now = options?.now ?? new Date();
  const judging: JudgingBudget = { remaining: SWEEP_MAX_JUDGING_RUNS };
  const pageSize = options?.pageSize ?? SWEEP_PAGE_SIZE;
  const maxRuns = options?.maxRuns ?? SWEEP_MAX_RUNS;
  const staleBefore = new Date(now.getTime() - VERIFY_ROLLUP_GRACE_MS);
  const abandonedBound = new Date(now.getTime() - VERIFY_ABANDONED_MS);
  const outcome: VerifySweepOutcome = {
    abandoned: [],
    settled: [],
    evidenceRecovered: [],
    skipped: 0,
  };

  // Split the tick's run allowance between the two scans rather than sharing one
  // counter. `maxRuns` bounds the whole tick, so the evidence half cannot get a
  // second full allowance — but a single shared counter would let a backlog of
  // *untouchable* `verifying` rows (a check whose verifier operation is still
  // live) consume the whole allowance: those rows keep their `updated_at` and
  // head the ordered scan again on every tick, so the `collecting_evidence` scan
  // would never run and its runs would strand for good. A per-state slice keeps
  // the tick bounded while guaranteeing both states make progress.
  const verifyingRunCap = Math.floor(maxRuns / 2);
  const evidenceRunCap = maxRuns - verifyingRunCap;
  const verifyingRuns = { remaining: verifyingRunCap };
  const evidenceRuns = { remaining: evidenceRunCap };

  const scan = async (
    find: typeof VerifyRunModel.findStuckVerifying,
    olderThan: Date,
    recover: (
      run: VerifyRunItem,
    ) => Promise<'abandoned' | 'settled' | 'evidenceRecovered' | 'skipped'>,
    budget: { remaining: number },
  ) => {
    // Walk the whole stranded set, not just its oldest page: rows the sweep
    // leaves alone keep their timestamp, so a single fixed-size read would
    // return the same untouchable rows forever and never reach the runs
    // behind them.
    let after: { id: string; updatedAt: Date } | undefined;

    while (budget.remaining > 0) {
      const page = await find.call(VerifyRunModel, db, olderThan, { after, limit: pageSize });
      if (page.length === 0) break;

      for (const run of page) {
        if (budget.remaining <= 0) break;
        budget.remaining -= 1;
        try {
          const action = await recover(run);
          if (action === 'skipped') outcome.skipped += 1;
          else outcome[action].push(run.id);
        } catch (error) {
          // One poisoned run must not stop the sweep for the rest.
          log('recovering run %s failed (non-fatal): %O', run.id, error);
          outcome.skipped += 1;
        }
      }

      const last = page.at(-1)!;
      after = { id: last.id, updatedAt: last.updatedAt };
      if (page.length < pageSize) break;
    }
  };

  await scan(
    VerifyRunModel.findStuckVerifying,
    staleBefore,
    (run) => recoverRun(db, run, now),
    verifyingRuns,
  );
  await scan(
    VerifyRunModel.findStuckCollectingEvidence,
    abandonedBound,
    (run) => recoverEvidenceRun(db, run, now, judging),
    evidenceRuns,
  );

  if (verifyingRuns.remaining <= 0 || evidenceRuns.remaining <= 0) {
    log(
      'sweep hit a per-state run cap (%d verifying / %d evidence) — the tail is left for the next tick',
      verifyingRunCap,
      evidenceRunCap,
    );
  }

  return outcome;
};

/**
 * Recover a run stranded in `collecting_evidence`.
 *
 * The evidence turn is just another agent run; when it dies (abort, stall,
 * provider hang) or its terminal hook is lost, nothing ever submits evidence
 * and the run sits in `collecting_evidence` forever — the `claimVerifying`
 * gate would accept it, but nothing re-enters. Guards before acting:
 *
 * - **a live evidence operation** — still running or awaiting human/async tool
 *   work — may yet complete and submit; leave the run alone. The continuation
 *   is the child carrying the `acceptance-evidence-on-complete` hook in its
 *   persisted state, not just any child (the builder may have others), and a
 *   state that cannot be read (Redis down) is treated as potentially-live too.
 * - **partial evidence** — some rows already written but the turn died before
 *   covering the plan — is judged rather than backfilled, and only against the
 *   frozen deliverable: judging without it would pass the structural gate on
 *   uncovered criteria and render verdicts from nothing. A late turn that
 *   re-submits over these rows hits the idempotent upsert.
 *
 * With both guards cleared, the deliverable that `startEvidenceSubmission`
 * froze into the evidence hook's webhook body is backfilled as inline evidence
 * for every criterion — inside `enterJudging`, after the recovery lease is
 * taken, so overlapping sweeps cannot double-insert the evidence rows (see
 * {@link recordHeterogeneousDeliverableEvidence}). When the hook config is
 * gone (Redis TTL elapsed, instance recycled) the run degrades to the
 * errored-rows ending the plain sweep gives `verifying` runs — still
 * unblocking the acceptance.
 */
interface JudgingBudget {
  remaining: number;
}

/** Take one judge pass from this tick's budget; `false` leaves the run for the next tick. */
const takeJudgingSlot = (budget: JudgingBudget): boolean => {
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  return true;
};

const recoverEvidenceRun = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  now: Date,
  judging: JudgingBudget,
): Promise<'abandoned' | 'settled' | 'evidenceRecovered' | 'skipped'> => {
  const operationId = run.operationId;
  if (!operationId) {
    // The builder operation was deleted before the sweep ever selected this run —
    // the FK cleared `operation_id`, so there is no state to read a deliverable
    // from and nothing to judge against. Close the outstanding checks as
    // `errored` by run id, the same ending a dead verifier gets, so the
    // acceptance above can settle instead of waiting for a verdict forever.
    return closeOutstandingAsErrored(db, run, null, now, 'abandoned');
  }

  const workspaceId = run.workspaceId ?? undefined;
  const plan = (run.plan ?? []) as VerifyCheckItem[];
  if (plan.length === 0) return 'skipped';

  const resultModel = new VerifyCheckResultModel(db, run.userId, workspaceId);
  const submitted = await resultModel.listByRun(run.id);
  const evidenceRows = await new VerifyEvidenceModel(db, run.userId, workspaceId).listByRun(run.id);

  // The evidence hook's terminal callback follows the evidence continuation —
  // the child operation carrying the `acceptance-evidence-on-complete` hook in
  // its persisted state. The builder may have other children (sub-agents), so
  // the hook, not child order, identifies it. A state that fails to load
  // (Redis down) must not read as "not the collector": an unreadable live
  // child is left alone.
  const operationModel = new AgentOperationModel(db, run.userId, workspaceId);
  const children = await operationModel.listOperationTree(operationId);

  let evidenceOp: AgentOperationItem | undefined;
  let deliverable: string | null = null;
  let collectorUnknown = false;
  for (const child of children) {
    if (child.id === operationId || child.parentOperationId !== operationId) continue;
    const probe = await probeEvidenceHook(child.id, run.userId);
    if (probe.kind === 'hook') {
      evidenceOp = child;
      deliverable = probe.deliverable;
      break;
    }
    // Either way the child cannot be *proven* harmless, so the run is hands-off
    // entirely — a claim here could steal the ending of a live collector:
    //   `unknown` — the state read failed (Redis down).
    //   `no-state` on a live child — nothing is persisted for it, yet it is still
    //   running. A step that outlives the state TTL refreshes its operation lease
    //   (the heartbeat) but not the state blob, and its worker keeps the hook in
    //   memory, so it may still report valid evidence.
    if (
      probe.kind === 'unknown' ||
      (probe.kind === 'no-state' && LIVE_OPERATION_STATUSES.has(child.status))
    ) {
      collectorUnknown = true;
      break;
    }
    // `no-hook` (a readable state without the evidence hook — an unrelated
    // sub-agent) or `no-state` on a child that is already gone: not the collector.
  }

  // What counts as "something was submitted" is *evidence*, not the existence of a
  // result row. The native evidence tool upserts its result row first and inserts
  // the evidence after (`acceptanceEvidence`), so a collector that died in between
  // leaves a row with nothing behind it — reading that as a partial submission
  // would skip the backfill and leave criteria that still need the deliverable
  // marked `uncertain` instead of evidenced.
  const hasSubmission =
    evidenceRows.length > 0 || submitted.some((row) => !PENDING_RESULT_STATUSES.has(row.status));

  // Real evidence exists and the collector is gone — a judge pass is the honest
  // ending, judging what was submitted against the frozen deliverable (the
  // structural gate marks uncovered items `uncertain`). Judging without the
  // deliverable would pass the structural gate on uncovered criteria and render
  // verdicts from neither evidence nor the final output.
  if (hasSubmission) {
    if (collectorUnknown || (evidenceOp && LIVE_OPERATION_STATUSES.has(evidenceOp.status)))
      return 'skipped';
    if (!deliverable) return closeOutstandingAsErrored(db, run, operationId, now, 'abandoned');
    if (!takeJudgingSlot(judging)) return 'skipped';
    return enterJudging(db, run, operationId, run.userId, workspaceId, now, deliverable, {
      action: 'settled',
      // Judging what was submitted, and only that: the criteria the dead collector
      // never reached stay structurally uncovered so the gate marks them
      // `uncertain` instead of inheriting the deliverable as evidence.
      backfill: false,
    });
  }

  // No evidence yet: a live evidence turn may still submit, so only proceed
  // when the continuation can no longer produce an `onComplete`.
  if (collectorUnknown || (evidenceOp && LIVE_OPERATION_STATUSES.has(evidenceOp.status)))
    return 'skipped';

  const builderOp = children.find((op) => op.id === operationId);
  if (!deliverable || !builderOp) {
    // Nothing to backfill from (no surviving state, or the builder operation
    // itself is gone). The evidence op is dead, so closing the outstanding rows
    // as `errored` is the same ending the plain sweep gives a `verifying` run
    // whose verifier died.
    return closeOutstandingAsErrored(db, run, operationId, now, 'abandoned');
  }

  if (!takeJudgingSlot(judging)) return 'skipped';
  return enterJudging(
    db,
    run,
    operationId,
    run.userId,
    workspaceId,
    now,
    deliverable,
    // Nothing was submitted at all, so the criteria get the frozen deliverable as
    // their evidence before judging.
    { action: 'evidenceRecovered', backfill: true },
  );
};

/**
 * What the persisted agent state of a child operation says about the evidence
 * hook: `hook` — the child is the evidence continuation (`deliverable` is the
 * frozen output, null when the body lacks one); `no-hook` — the state loaded and
 * carries no evidence hook, so the child is an unrelated sub-agent; `no-state` —
 * nothing is persisted for the child at all (never written, or the Redis blob
 * expired); `unknown` — the read itself failed (Redis down).
 *
 * `no-state` and `no-hook` are not the same answer: a readable state without the
 * hook rules the child out entirely, while a *live* child with no state is
 * ambiguous — its worker may still be holding the hook in memory.
 */
type EvidenceHookProbe =
  | { deliverable: string | null; kind: 'hook' }
  | { kind: 'no-hook' }
  | { kind: 'no-state' }
  | { kind: 'unknown' };

const probeEvidenceHook = async (
  childOperationId: string,
  userId: string,
): Promise<EvidenceHookProbe> => {
  try {
    const stateManager = createAgentStateManager();
    const state = await stateManager.loadAgentState(childOperationId);
    if (!state) return { kind: 'no-state' };

    const hooks = state?.host?.hooks ?? [];

    for (const hook of hooks) {
      if (hook.id !== EVIDENCE_HOOK_ID) continue;
      const body = hook.webhook?.body as { deliverable?: unknown } | undefined;
      const deliverable = body?.deliverable;
      return {
        deliverable: typeof deliverable === 'string' && deliverable.length > 0 ? deliverable : null,
        kind: 'hook',
      };
    }
    return { kind: 'no-hook' };
  } catch (error) {
    // A missing Redis or an expired connection is transient — the sweep must
    // not read it as "not the collector" and touch a run that may still be
    // live. Callers treat `unknown` hands-off for live children.
    log('probing agent state for op %s (user %s) failed: %O', childOperationId, userId, error);
    return { kind: 'unknown' };
  }
};

/**
 * Close every outstanding required check as `errored`, roll the run up, and run
 * the finalizer — the same ending the plain sweep gives a `verifying` run whose
 * verifier died mid-flight (see {@link recoverRun}'s outstanding branch). Used
 * when the sweep owns a stranded run but holds nothing to judge with.
 *
 * `operationId` is the Agent Run link written onto the closed rows, or `null`
 * once that operation was deleted — the claim then goes through the run itself.
 * `options.leaseHeld` reuses a lease the caller already won.
 */
const closeOutstandingAsErrored = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  operationId: string | null,
  now: Date,
  action: 'abandoned' | 'settled' | 'evidenceRecovered',
  options?: { leaseHeld?: boolean },
): Promise<'abandoned' | 'settled' | 'evidenceRecovered' | 'skipped'> => {
  const statusService = new VerifyStatusService(db, run.userId, run.workspaceId ?? undefined);

  // The caller may already own the lease: `enterJudging` wins `claimVerifying`
  // and only then discovers the operation is gone. Re-claiming would CAS against
  // the very `updated_at` that claim just stamped, so it would always lose and
  // return `skipped` — leaving the run stranded in `verifying` (and, once its FK
  // is cleared, invisible to the sweep's operation-scoped scan). Reuse the lease.
  if (!options?.leaseHeld) {
    const staleBefore = new Date(now.getTime() - VERIFY_ROLLUP_GRACE_MS);
    // Claim by operation when we still have one, by run id otherwise: the FK
    // clears `operation_id` when the Agent Run is deleted, and the sweep must
    // still settle the run it selected.
    const claimed = operationId
      ? await statusService.claimVerifying(operationId, staleBefore)
      : await statusService.claimVerifyingByRunId(run.id, staleBefore);
    if (!claimed) return 'skipped';
  }

  const workspaceId = run.workspaceId ?? undefined;
  const plan = (run.plan ?? []) as VerifyCheckItem[];
  const resultModel = new VerifyCheckResultModel(db, run.userId, workspaceId);

  // Only the items that never reached a verdict are closed — the same gate
  // `recoverRun` applies. Flattening an item that already landed would discard a
  // real verdict, and `submitCheckEvidence` permits a terminal row to sit here.
  const results = await resultModel.listByRun(run.id);
  const byItem = new Map(results.map((result) => [result.checkItemId, result]));
  const operationModel = new AgentOperationModel(db, run.userId, workspaceId);
  const closeable: VerifyCheckItem[] = [];
  for (const item of plan.filter((entry) => entry.required)) {
    const result = byItem.get(item.id);
    if (result && !PENDING_RESULT_STATUSES.has(result.status)) continue;

    const verifierOperationId = result?.verifierOperationId;
    if (verifierOperationId) {
      const verifierOp = await operationModel.findById(verifierOperationId);
      // Its verifier is still working — `settleVerifierCheckFromTerminal` owns that
      // row's ending, and stamping it `errored` now would discard a verdict that is
      // still coming (the same guard `recoverRun` applies).
      if (verifierOp && LIVE_OPERATION_STATUSES.has(verifierOp.status)) continue;
    }

    closeable.push(item);
  }

  // Bounded: the plan is one entry per acceptance criterion, so its length is
  // persisted runtime data, not a constant.
  const closeRows = (linkOperationId: string | null) =>
    pMap(
      closeable,
      (item) =>
        // Upsert, not update: an item with no row at all must still land as
        // `errored`, and a pending row (evidence uploaded mid-run) is closed too.
        resultModel.upsertByCheckItem({
          ...planItemToPendingResult(run.id, linkOperationId, item),
          // Re-asserted after the spread: the upsert key is required, and the
          // snapshot's own fields are optional-nullable.
          checkItemId: item.id,
          verifyRunId: run.id,
          completedAt: now,
          status: 'errored',
          suggestion: 'Rerun verification for this delivery.',
          toulmin: {
            limitation: 'Evidence collection was interrupted before this check was judged.',
          },
        }),
      { concurrency: 5 },
    );

  try {
    await closeRows(operationId);
  } catch (error) {
    // The operation can be deleted between the claim above and this write: the FK
    // then rejects the captured link (`onDelete: 'set null'` only rewrites the
    // run's own column, not rows written afterwards). Retry without it — the rows
    // still have to close, or the run would stay leased in `verifying` with its
    // link cleared and no scan able to see it.
    if (!operationId) throw error;
    await closeRows(null);
  }

  // Settle by run id, not by operation: when the Agent Run was deleted the FK
  // clears `verify_runs.operation_id`, and the operation-addressed rollup would
  // resolve to nothing — settling this run is exactly why we are here.
  await statusService.recomputeByRunId(run.id);
  // With the operation gone there is nothing left to drive; the finalizer
  // resolves by operation and would no-op anyway.
  if (operationId) {
    try {
      await finalizeVerifyRun(db, run.userId, operationId, {}, workspaceId);
    } catch (error) {
      // The run is terminal from here on, so no scan would look at it again and the
      // finalizer — which may still owe the bound task a drive, or a repair — would
      // never be retried. Park the run where the evidence half re-enters and drives
      // the finalizer again.
      await statusService.reopenForFinalizeRetry(run.id);
      throw error;
    }
  }

  log('recovered run %s (op %s) as %s', run.id, operationId, action);
  return action;
};

/**
 * Claim the run into `verifying` and run a real judge pass, then the shared
 * finalizer — the mirror of the lifecycle's normal completion path (resolve the
 * deliverable and model config, run the executor, finalize). Only claiming and
 * finalizing would leave the pending rows untouched: `recompute` reads them as
 * `verifying`, `maybeAutoRepair` waits for terminal rows, and `finalizeVerifyRun`
 * early-returns — the run would strand again and the next sweep would close it
 * `errored`, so the recovery would recover nothing.
 *
 * `deliverable` is the hook's frozen final output, recovered by the caller —
 * both call sites pass it non-empty, and the executor requires it for judging.
 * `options.backfill` selects whether uncovered criteria get that output as
 * synthesized evidence, and the write runs here, after the claim: an overlapping
 * sweep that loses the lease must not double-insert the evidence rows
 * (`createMany` is an unconstrained insert).
 */
const enterJudging = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  operationId: string,
  userId: string,
  workspaceId: string | undefined,
  now: Date,
  deliverable: string,
  options: {
    action: 'abandoned' | 'settled' | 'evidenceRecovered';
    /**
     * Synthesize evidence from the deliverable for criteria the builder left
     * uncovered. Only the zero-evidence recovery may do this. On the
     * partial-evidence path those criteria have to stay structurally uncovered so
     * the gate marks them `uncertain` — backfilling the generic deliverable would
     * make them look evidenced, and they could pass.
     */
    backfill: boolean;
  },
): Promise<'abandoned' | 'settled' | 'evidenceRecovered' | 'skipped'> => {
  const { action, backfill } = options;
  const statusService = new VerifyStatusService(db, userId, workspaceId);
  if (
    !(await statusService.claimVerifying(
      operationId,
      new Date(now.getTime() - VERIFY_ROLLUP_GRACE_MS),
    ))
  )
    return 'skipped';

  const op = await new AgentOperationModel(db, userId, workspaceId).findById(operationId);
  if (!op) {
    // The operation row is gone — nothing left to resolve a verifier against.
    // Close the outstanding checks as `errored` under the lease we already hold
    // (it cannot be re-claimed once the operation is deleted) and settle the run
    // by its own id, in the same tick.
    return closeOutstandingAsErrored(db, run, null, now, 'abandoned', { leaseHeld: true });
  }

  // Carried out of the recovery `try` so the finalizer can run outside it: a
  // finalizer failure must not send the run back through the recovery path.
  let report:
    | { deliverable: string; goal: string; modelConfig: { model: string; provider: string } }
    | undefined;
  // Set just before the judge pass: the point past which *this* attempt may have
  // written verdicts. A predicate read afterwards cannot tell those apart from
  // verdicts that were already on the run before we claimed it.
  let judgeStarted = false;

  // The backfill write follows the lease, not the skip guards — an overlapping
  // worker that reaches the insert before its claim attempt must not duplicate
  // the evidence rows against the winner's insert.
  try {
    if (backfill) {
      await recordHeterogeneousDeliverableEvidence({
        db,
        deliverable,
        operation: op,
        plan: (run.plan ?? []) as VerifyCheckItem[],
        userId,
        workspaceId,
      });
    }

    const resolvedAcceptance = op.taskId
      ? await resolveTaskAcceptance(db, userId, op.taskId, workspaceId)
      : undefined;
    const verifierAgentId = resolvedAcceptance?.config.verifierAgentId ?? undefined;

    // The same deliverable resolution the completion lifecycle applies: task-pinned
    // documents join the frozen output so the judge sees the full context.
    const resolvedDeliverable = await resolveVerificationDeliverable(
      db,
      userId,
      deliverable,
      op.taskId,
      workspaceId,
    );

    const modelConfig = await resolveVerifyModelConfig(
      db,
      userId,
      {
        parentModel: op.model,
        parentProvider: op.provider,
        verifierAgentId,
      },
      workspaceId,
    );

    // The same report context the inline lifecycle passes: a recovered judge holds
    // the frozen deliverable and the resolved model config, so a terminal settle
    // must produce the same report card instead of skipping it.
    report = { deliverable: resolvedDeliverable, goal: run.goal ?? '', modelConfig };

    // What a parked finalizer retry re-enters with: every required check already
    // holds a verdict, so the only missing work is the rollup and the finalizer —
    // which is exactly what the report context above is for. Running the executor
    // again would re-judge terminal checks: overwriting verdicts and billing the
    // model a second time.
    const existing = await new VerifyCheckResultModel(db, run.userId, workspaceId).listByRun(
      run.id,
    );
    const byItem = new Map(existing.map((row) => [row.checkItemId, row]));
    const required = ((run.plan ?? []) as VerifyCheckItem[]).filter((item) => item.required);
    const alreadyJudged =
      required.length > 0 &&
      required.every((item) => {
        const row = byItem.get(item.id);
        return row !== undefined && !PENDING_RESULT_STATUSES.has(row.status);
      });

    if (!alreadyJudged) {
      judgeStarted = true;
      const executor = new VerifyExecutorService(db, userId, workspaceId);
      await executor.execute({
        deliverable: resolvedDeliverable,
        goal: run.goal ?? '',
        modelConfig,
        operationId,
        runVerifierAgent: createVerifierAgentRunner({
          db,
          deliverable: resolvedDeliverable,
          model: modelConfig.model,
          provider: modelConfig.provider,
          taskId: op.taskId,
          topicId: op.topicId,
          userId,
          verifierAgentId,
          workspaceId,
        }),
      });
    }
  } catch (error) {
    const opGone = !(await new AgentOperationModel(db, userId, workspaceId).findById(operationId));

    if (!opGone && !judgeStarted) {
      // The judge never ran, so this attempt persisted nothing of its own — even a
      // verdict that was already on the run before we claimed it belongs to an
      // earlier attempt. Hand the run back for a clean retry: the evidence scan is
      // the only half that can retry the judge, and leaving the run in `verifying`
      // would drop it from that scan while the `verifying` half eventually closed
      // its checks `errored`. The backfill this retry redoes is atomic, so it cannot
      // leave the run half-evidenced.
      await statusService.restoreEvidenceCollection(run.id);
      throw error;
    }

    // Either the operation is gone — its FK clears the run's link, so nothing
    // operation-addressed can settle the run any more — or the judge had started, so
    // it may already have written verdicts. The executor only *creates* the rows a
    // check is missing and re-judges whatever already has one, so re-entering
    // evidence collection would overwrite verdicts, bill the model a second time,
    // and can spawn a duplicate verifier. Close what never landed, preserving what
    // did, and settle by run id under the lease we hold.
    return closeOutstandingAsErrored(db, run, opGone ? null : operationId, now, 'abandoned', {
      leaseHeld: true,
    });
  }

  // Settlement, deliberately outside the recovery `try` so a failure here cannot
  // re-enter the recovery path. `execute` ends by rolling the round up **by
  // operation**, and the finalizer resolves the run the same way — both return
  // silently if the operation was deleted mid-judge, so there is no error to react
  // to and the run would stay leased in `verifying`, invisible to the next sweep's
  // operation-scoped scan. Roll up by run id under the held lease so the verdict
  // the executor produced actually lands. Idempotent: `rollUp` derives the status
  // from the plan and the results, so a run already settled is left alone.
  await statusService.recomputeByRunId(run.id);
  try {
    await finalizeVerifyRun(db, userId, operationId, { report }, workspaceId);
  } catch (error) {
    // The verdicts stand, so the judge must not be re-entered — but what failed is
    // the finalizer's own work (report, repair, task drive), and nothing else would
    // retry it: every scan selects only `verifying`, `collecting_evidence`, or an
    // eligible `planned` round, so a terminal run is never looked at again and its
    // bound task could stay active forever. Park it back in `verifying`, where the
    // verifying half re-derives the rollup and runs the finalizer again — without
    // re-judging.
    await statusService.reopenForFinalizeRetry(run.id);
    throw error;
  }

  log('recovered run %s (op %s) as %s', run.id, operationId, action);
  return action;
};

const recoverRun = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  now: Date,
): Promise<'abandoned' | 'settled' | 'skipped'> => {
  const operationId = run.operationId;
  if (!operationId) return 'skipped';
  if (run.status === 'planned') {
    return (await settleFailedRepair(db, run.userId, operationId, run.workspaceId ?? undefined))
      ? 'abandoned'
      : 'skipped';
  }

  const workspaceId = run.workspaceId ?? undefined;
  const plan = (run.plan ?? []) as VerifyCheckItem[];
  if (plan.length === 0) return 'skipped';

  const resultModel = new VerifyCheckResultModel(db, run.userId, workspaceId);
  const results = await resultModel.listByRun(run.id);
  const byItem = new Map(results.map((result) => [result.checkItemId, result]));

  // Only required items decide the rollup — the same gate `recompute` applies.
  const outstanding = plan
    .filter((item) => item.required)
    .filter((item) => {
      const result = byItem.get(item.id);
      return !result || PENDING_RESULT_STATUSES.has(result.status);
    });

  if (outstanding.length > 0) {
    if (now.getTime() - run.updatedAt.getTime() < VERIFY_ABANDONED_MS) return 'skipped';

    const operationModel = new AgentOperationModel(db, run.userId, workspaceId);
    for (const item of outstanding) {
      const verifierOperationId = byItem.get(item.id)?.verifierOperationId;
      if (!verifierOperationId) continue;
      const verifierOp = await operationModel.findById(verifierOperationId);
      // Its verifier is still working — `settleVerifierCheckFromTerminal` owns
      // this row's ending, and stamping it `errored` now would discard a verdict
      // that is still coming.
      // A still-live verifier (parked ones included) can still produce a verdict.
      if (verifierOp && isAgentOperationInFlight(verifierOp.status)) return 'skipped';
    }
  }

  // Committed to acting — take the lease first. Everything below has side effects
  // beyond this run: `finalizeVerifyRun` spawns the repair round, and
  // `triggerAutoRepair` has no claim of its own, so two overlapping sweep
  // deliveries reaching it would launch duplicate repair agents against the same
  // failures. The claim re-stamps `updated_at`, which is exactly what a
  // concurrent sweep's CAS tests against, so the loser drops the run.
  //
  // Deliberately after the skip decisions: claiming a run we then leave alone
  // would push its `updated_at` forward every tick and it would never reach the
  // abandoned bound.
  const statusService = new VerifyStatusService(db, run.userId, workspaceId);
  if (
    !(await statusService.claimVerifying(
      operationId,
      new Date(now.getTime() - VERIFY_ROLLUP_GRACE_MS),
    ))
  )
    return 'skipped';

  if (outstanding.length > 0) {
    await Promise.all(
      outstanding.map((item) =>
        // Upsert, not update: a run interrupted between entering `verifying` and
        // creating its pending rows has plan items with no row at all. Updating
        // would touch nothing, `recompute` would still read them as pending, and
        // the run would stay stranded while the sweep reported it recovered.
        resultModel.upsertByCheckItem({
          ...planItemToPendingResult(run.id, operationId, item),
          // Re-asserted after the spread: the upsert key is required, and the
          // snapshot's own fields are optional-nullable.
          checkItemId: item.id,
          verifyRunId: run.id,
          completedAt: now,
          status: 'errored',
          suggestion: 'Rerun verification for this delivery.',
          toulmin: { limitation: 'Verification was interrupted before this check was judged.' },
        }),
      ),
    );
  }

  // Settle by run id: this recovery owns the run it just claimed, and the
  // operation-addressed rollup would silently resolve to nothing if that
  // operation were deleted mid-flight — leaving the run leased in `verifying`,
  // where (with its FK cleared) the next sweep's scan can no longer see it.
  await statusService.recomputeByRunId(run.id);
  // No report context — the sweep holds no deliverable. The task is still driven,
  // which is the whole point: the goal has been waiting on this verdict.
  await finalizeVerifyRun(db, run.userId, operationId, {}, workspaceId);

  const action = outstanding.length > 0 ? 'abandoned' : 'settled';
  log('recovered run %s (op %s) as %s', run.id, operationId, action);
  return action;
};
