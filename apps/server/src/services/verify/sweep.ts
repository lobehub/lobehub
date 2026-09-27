import type { VerifyCheckItem } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { VerifyRunItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { createAgentStateManager } from '@/server/modules/AgentRuntime';

import { createVerifierAgentRunner } from './agentVerifier';
import { recordHeterogeneousDeliverableEvidence } from './evidenceSubmission';
import { VerifyExecutorService } from './executor';
import { resolveVerifyModelConfig } from './modelConfig';
import { settleFailedRepair } from './repairTerminal';
import { planItemToPendingResult } from './resultSnapshot';
import { finalizeVerifyRun } from './settle';
import { VERIFY_ABANDONED_MS, VERIFY_ROLLUP_GRACE_MS } from './staleness';
import { VerifyStatusService } from './statusService';
import { resolveTaskAcceptance } from './taskAcceptance';

const log = debug('lobe-server:verify-sweep');

/** An operation in any of these can still produce a verdict. */
const LIVE_OPERATION_STATUSES = new Set([
  'idle',
  'running',
  'waiting_for_human',
  'waiting_for_async_tool',
]);

const PENDING_RESULT_STATUSES = new Set(['pending', 'running']);

const SWEEP_PAGE_SIZE = 100;
/** Bound one tick's work; whatever is left is still there on the next one. */
const SWEEP_MAX_RUNS = 1000;

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
  options?: { now?: Date; pageSize?: number },
): Promise<VerifySweepOutcome> => {
  const now = options?.now ?? new Date();
  const pageSize = options?.pageSize ?? SWEEP_PAGE_SIZE;
  const staleBefore = new Date(now.getTime() - VERIFY_ROLLUP_GRACE_MS);
  const abandonedBound = new Date(now.getTime() - VERIFY_ABANDONED_MS);
  const outcome: VerifySweepOutcome = {
    abandoned: [],
    settled: [],
    evidenceRecovered: [],
    skipped: 0,
  };

  const scan = async (
    find: typeof VerifyRunModel.findStuckVerifying,
    olderThan: Date,
    recover: (
      run: VerifyRunItem,
    ) => Promise<'abandoned' | 'settled' | 'evidenceRecovered' | 'skipped'>,
  ) => {
    // Walk the whole stranded set, not just its oldest page: rows the sweep
    // leaves alone keep their timestamp, so a single fixed-size read would
    // return the same untouchable rows forever and never reach the runs
    // behind them.
    let after: { id: string; updatedAt: Date } | undefined;
    let scanned = 0;

    while (scanned < SWEEP_MAX_RUNS) {
      const page = await find.call(VerifyRunModel, db, olderThan, { after, limit: pageSize });
      if (page.length === 0) break;

      for (const run of page) {
        scanned += 1;
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

    if (scanned >= SWEEP_MAX_RUNS) {
      log('sweep hit the per-run cap (%d) — the tail is left for the next tick', SWEEP_MAX_RUNS);
    }
  };

  await scan(VerifyRunModel.findStuckVerifying, staleBefore, (run) => recoverRun(db, run, now));
  await scan(VerifyRunModel.findStuckCollectingEvidence, abandonedBound, (run) =>
    recoverEvidenceRun(db, run, now),
  );

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
 * - **partial evidence** — some rows already written but the turn died before
 *   covering the plan — is judged rather than backfilled: the real judge pass
 *   sees what was submitted (the structural gate marks the gaps `uncertain`).
 *   A late turn that re-submits over these rows hits the idempotent upsert.
 * - **a live evidence operation** — still running or awaiting human/async tool
 *   work — may yet complete and submit; leave the run alone.
 *
 * With both guards cleared, the deliverable that `startEvidenceSubmission`
 * froze into the evidence hook's webhook body is backfilled as inline evidence
 * for every criterion — the same write a heterogeneous builder performs (see
 * {@link recordHeterogeneousDeliverableEvidence}). The hook config is
 * recovered from the persisted agent state; when that is gone (Redis TTL
 * elapsed, instance recycled) the run degrades to the errored-rows ending the
 * plain sweep gives `verifying` runs — still unblocking the acceptance.
 */
const recoverEvidenceRun = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  now: Date,
): Promise<'abandoned' | 'settled' | 'evidenceRecovered' | 'skipped'> => {
  const operationId = run.operationId;
  if (!operationId) return 'skipped';

  const workspaceId = run.workspaceId ?? undefined;
  const plan = (run.plan ?? []) as VerifyCheckItem[];
  if (plan.length === 0) return 'skipped';

  const resultModel = new VerifyCheckResultModel(db, run.userId, workspaceId);
  const submitted = await resultModel.listByRun(run.id);

  // The evidence hook's terminal callback follows the evidence child op, so a
  // run with any submitted rows is only judged once that child can no longer
  // produce an `onComplete` — the same live guard the no-evidence path applies
  // below. Ordering matters: the claim inside `enterJudging` would otherwise
  // steal the ending from a collector that is still running with partial rows.
  const operationModel = new AgentOperationModel(db, run.userId, workspaceId);
  const children = await operationModel.listOperationTree(operationId);
  const evidenceOp = children.find(
    (op) => op.id !== operationId && op.parentOperationId === operationId,
  );
  const evidenceOpLive = Boolean(evidenceOp && LIVE_OPERATION_STATUSES.has(evidenceOp.status));

  // Real evidence exists and the collector is gone — a judge pass is the honest
  // ending. Re-running the executor judges what was submitted (the structural
  // gate marks uncovered items `uncertain`) instead of inventing verdicts.
  if (submitted.length > 0) {
    if (evidenceOpLive) return 'skipped';
    return enterJudging(db, run, operationId, run.userId, workspaceId, now, 'settled');
  }

  // No evidence yet: a live evidence turn may still submit, so only proceed
  // when its child operation can no longer produce an `onComplete`.
  if (evidenceOpLive) return 'skipped';

  // The evidence hook's webhook body carries the deliverable the turn was
  // given — read it back from the persisted agent state. The hooks persist onto
  // the evidence child op's runtime state (the continuation run), not the
  // builder's, so the child's id is the state key.
  const deliverable = evidenceOp
    ? await loadEvidenceHookDeliverable(evidenceOp.id, run.userId)
    : null;
  const builderOp = children.find((op) => op.id === operationId);
  if (!deliverable || !builderOp) {
    // Nothing to backfill from (no surviving state, or the builder operation
    // itself is gone). The evidence op is dead, so closing the outstanding rows
    // as `errored` is the same ending the plain sweep gives a `verifying` run
    // whose verifier died.
    return closeOutstandingAsErrored(db, run, operationId, now, 'abandoned');
  }

  await recordHeterogeneousDeliverableEvidence({
    db,
    deliverable,
    operation: builderOp,
    plan,
    userId: run.userId,
    workspaceId,
  });

  return enterJudging(db, run, operationId, run.userId, workspaceId, now, 'evidenceRecovered');
};

/**
 * Read the deliverable frozen into the evidence hook's webhook body, from the
 * persisted agent state (`host.hooks[].webhook.body.deliverable`). Returns
 * null when no state survives (Redis TTL elapsed) or no evidence hook exists.
 */
const loadEvidenceHookDeliverable = async (
  operationId: string,
  userId: string,
): Promise<string | null> => {
  try {
    const stateManager = createAgentStateManager();
    const state = await stateManager.loadAgentState(operationId);
    const hooks = state?.host?.hooks ?? [];

    for (const hook of hooks) {
      const body = hook.webhook?.body as { deliverable?: unknown } | undefined;
      const deliverable = body?.deliverable;
      if (typeof deliverable === 'string' && deliverable.length > 0) return deliverable;
    }
    return null;
  } catch (error) {
    // A missing Redis or an expired key is the common case; the sweep must
    // still settle the run, just without the deliverable backfill.
    log('loading agent state for op %s (user %s) failed: %O', operationId, userId, error);
    return null;
  }
};

/**
 * Close every outstanding required check as `errored`, roll the run up, and run
 * the finalizer — the same ending the plain sweep gives a `verifying` run whose
 * verifier died mid-flight (see {@link recoverRun}'s outstanding branch). Used
 * when the sweep owns a stranded run but holds nothing to judge with.
 */
const closeOutstandingAsErrored = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  operationId: string,
  now: Date,
  action: 'abandoned' | 'settled' | 'evidenceRecovered',
): Promise<'abandoned' | 'settled' | 'evidenceRecovered' | 'skipped'> => {
  const statusService = new VerifyStatusService(db, run.userId, run.workspaceId ?? undefined);
  if (
    !(await statusService.claimVerifying(
      operationId,
      new Date(now.getTime() - VERIFY_ROLLUP_GRACE_MS),
    ))
  )
    return 'skipped';

  const workspaceId = run.workspaceId ?? undefined;
  const plan = (run.plan ?? []) as VerifyCheckItem[];
  const resultModel = new VerifyCheckResultModel(db, run.userId, workspaceId);

  await Promise.all(
    plan
      .filter((item) => item.required)
      .map((item) =>
        // Upsert, not update: an item with no row at all must still land as
        // `errored`, and a pending row (evidence uploaded mid-run) is closed too.
        resultModel.upsertByCheckItem({
          ...planItemToPendingResult(run.id, operationId, item),
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
      ),
  );

  await statusService.recompute(operationId);
  await finalizeVerifyRun(db, run.userId, operationId, {}, workspaceId);

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
 */
const enterJudging = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  operationId: string,
  userId: string,
  workspaceId: string | undefined,
  now: Date,
  action: 'abandoned' | 'settled' | 'evidenceRecovered',
): Promise<'abandoned' | 'settled' | 'evidenceRecovered' | 'skipped'> => {
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
    // The operation row is gone — nothing to resolve a verifier against. Close
    // the outstanding checks as `errored` in the same tick instead of leaving
    // them for the next sweep to find.
    return closeOutstandingAsErrored(db, run, operationId, now, action);
  }

  const resolvedAcceptance = op.taskId
    ? await resolveTaskAcceptance(db, userId, op.taskId, workspaceId)
    : undefined;
  const verifierAgentId = resolvedAcceptance?.config.verifierAgentId ?? undefined;

  // No deliverable context — inline (LLM) checks are judged on submitted
  // evidence alone, and checks needing the deliverable text degrade to the
  // errored-rows ending below. The task is still driven: the goal has been
  // waiting on this verdict.
  const goal = run.goal ?? '';

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

  const executor = new VerifyExecutorService(db, userId, workspaceId);
  await executor.execute({
    deliverable: '',
    goal,
    modelConfig,
    operationId,
    runVerifierAgent: createVerifierAgentRunner({
      db,
      deliverable: '',
      model: modelConfig.model,
      provider: modelConfig.provider,
      taskId: op.taskId,
      topicId: op.topicId,
      userId,
      verifierAgentId,
      workspaceId,
    }),
  });

  await finalizeVerifyRun(db, userId, operationId, {}, workspaceId);

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
      if (verifierOp && LIVE_OPERATION_STATUSES.has(verifierOp.status)) return 'skipped';
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

  await statusService.recompute(operationId);
  // No report context — the sweep holds no deliverable. The task is still driven,
  // which is the whole point: the goal has been waiting on this verdict.
  await finalizeVerifyRun(db, run.userId, operationId, {}, workspaceId);

  const action = outstanding.length > 0 ? 'abandoned' : 'settled';
  log('recovered run %s (op %s) as %s', run.id, operationId, action);
  return action;
};
