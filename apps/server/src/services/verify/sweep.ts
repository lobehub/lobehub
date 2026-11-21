import type { AgentOperationStatus, VerifyCheckItem } from '@lobechat/types';
import { isAgentOperationInFlight } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { VerifyRunItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

import {
  redriveClaimedVerification,
  runVerifyAfterEvidenceSubmission,
  runVerifyOnCompletion,
} from './lifecycle';
import { settleFailedRepair } from './repairTerminal';
import { planItemToPendingResult } from './resultSnapshot';
import { finalizeVerifyRun } from './settle';
import { VERIFY_ABANDONED_MS, VERIFY_ROLLUP_GRACE_MS } from './staleness';
import { VerifyStatusService } from './statusService';
import { releaseUndeliveredRound } from './undeliveredRound';

const log = debug('lobe-server:verify-sweep');

const PENDING_RESULT_STATUSES = new Set(['pending', 'running']);

const SWEEP_PAGE_SIZE = 100;
/** Bound one tick's work; whatever is left is still there on the next one. */
const SWEEP_MAX_RUNS = 1000;

export interface VerifySweepOutcome {
  /** Runs whose outstanding checks were closed as `errored` before the rollup. */
  abandoned: string[];
  /** Runs whose judging never started a verifier and was started again. */
  redriven: string[];
  /** Task rounds taken off their acceptance because the run never delivered. */
  released: string[];
  /** Runs whose checks had all landed and only needed the missing rollup. */
  settled: string[];
  /** Runs left alone — still plausibly mid-flight. */
  skipped: number;
}

/**
 * Recover verification runs stranded in `verifying`, planned repairs whose
 * operation has already failed or been interrupted, and task rounds whose run
 * ended without a delivery (see {@link releaseUndeliveredRound}).
 *
 * Entering `verifying` is a durable write; the judging that leaves it runs as
 * post-response work, so any host-level interruption — instance recycled,
 * deploy, OOM, provider hang — strands the run. Nothing downstream re-reads it:
 * the rollup is denormalized, the read paths trust it, and the task watchdog
 * only looks at tasks carrying a heartbeat timeout. Without this sweep such a
 * run is stuck for good, and so is the acceptance and goal card above it.
 *
 * Two shapes, deliberately treated differently:
 *
 * - **the rollup was lost** — every required check already holds a terminal
 *   verdict, so the truth is on disk and only the denormalized status disagrees.
 *   Recomputing is pure derivation; the only reason to wait out
 *   {@link VERIFY_ROLLUP_GRACE_MS} first is to stay clear of a live finalizer.
 * - **the verifier died mid-flight** — checks are still pending/running. Those
 *   carry no verdict and never will, so after {@link VERIFY_ABANDONED_MS} they
 *   are closed as `errored` (an infra failure, not a delivery judgment, so they
 *   neither gate delivery nor seed auto-repair) and the rollup follows.
 * - **no verifier ever started** — the attempt died between claiming
 *   `verifying` and spawning its verifiers, so the builder's evidence was never
 *   judged at all. Closing it as `errored` would end the round without a
 *   verdict, so the latest round of a successful run is judged again, once
 *   (see {@link canRedrive}). A second stall falls back to `errored`.
 *
 * A round a later round of its acceptance superseded only gets its rollup; the
 * task is driven by the latest round alone.
 *
 * A check bound to a verifier operation that is still live keeps the whole run
 * out of the sweep however old it is — an agent verifier is a full sub-agent run
 * and its own terminal hook is what settles it.
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
  const outcome: VerifySweepOutcome = {
    abandoned: [],
    redriven: [],
    released: [],
    settled: [],
    skipped: 0,
  };

  // Walk the whole stranded set, not just its oldest page: rows the sweep leaves
  // alone keep their timestamp, so a single fixed-size read would return the same
  // untouchable rows forever and never reach the runs behind them.
  let after: { id: string; updatedAt: Date } | undefined;
  let scanned = 0;

  while (scanned < SWEEP_MAX_RUNS) {
    const page = await VerifyRunModel.findStuckVerifying(db, staleBefore, {
      after,
      limit: pageSize,
    });
    if (page.length === 0) break;

    for (const run of page) {
      scanned += 1;
      try {
        const action = await recoverRun(db, run, now);
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

  return outcome;
};

const recoverRun = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  now: Date,
): Promise<'abandoned' | 'redriven' | 'released' | 'settled' | 'skipped'> => {
  const operationId = run.operationId;
  if (!operationId) return 'skipped';
  const workspaceId = run.workspaceId ?? undefined;
  if (run.status === 'planned') {
    if (await settleFailedRepair(db, run.userId, operationId, workspaceId)) return 'abandoned';
    return (await releaseUndeliveredRound(db, run.userId, operationId, workspaceId))
      ? 'released'
      : 'skipped';
  }

  // An abandoned repair claim: `triggerAutoRepair` stamps `repairing` durably
  // before spawning, so a worker killed in that window strands the run — both
  // repair paths skip `repairing`, and without a sweep predicate nothing ever
  // reclaims it. The model query only hands over rows stale past the rollup
  // grace, so reaching this branch means the spawner has been gone for a
  // while. Skip while a repair child is still in flight (a live child owns
  // this run's settlement); finish a settled child whose finalizer died;
  // otherwise retake the claim via CAS and let the recomputed rollup +
  // finalizer re-drive repair for the same failures.
  if (run.status === 'repairing') {
    const operationModel = new AgentOperationModel(db, run.userId, workspaceId);
    const runModel = new VerifyRunModel(db, run.userId, workspaceId);
    const children = await operationModel.listOperationTree(operationId);
    // A repair child that is still working — or whose own round is still being
    // judged — keeps the claim: its spawner died, but that child owns the
    // parent's settlement (its finalizer recomputes the parent through
    // `recomputeRepairAncestors`). Only a chain that is dead end to end is safe
    // to reclaim; reclaiming earlier would spawn a duplicate repair against the
    // same failures while the first one is still being verified.
    const repairChildren = children.filter(
      (child) => child.id !== operationId && child.parentOperationId === operationId,
    );
    for (const child of repairChildren) {
      if (await isRepairChainLive(child, operationModel, runModel, now)) return 'skipped';
    }

    // A repair round that settled but whose finalizer died is not the pre-spawn
    // shape: `createRepairRunner` already attached it as the acceptance's next
    // round, so reclaiming this parent would end in a suppressed finalizer
    // (`isLatestRound`), and the settled child is never swept on its own — the
    // task and acceptance would hang for good. Finish what that child's
    // finalizer started instead: it decides the child's own repair, collapses
    // this parent through `recomputeRepairAncestors`, and drives the task.
    // Overlapping sweeps are safe here — the repair claim and the task drive
    // inside the finalizer are both CAS-guarded.
    const strandedRound = await findStrandedRepairRound(db, run, repairChildren, runModel);
    if (strandedRound?.stage === 'settled') {
      await finalizeVerifyRun(db, run.userId, strandedRound.operationId, {}, workspaceId);
      log(
        'finalized stranded repair round %s of run %s (op %s)',
        strandedRound.operationId,
        run.id,
        operationId,
      );
      return 'settled';
    }
    // A repair that finished its work but whose round never reached judging:
    // its completion hook (or the evidence turn's) died before the round left
    // `planned` / `collecting_evidence`. The round is not swept on its own —
    // only a failed repair's `planned` round is — and reclaiming this parent
    // ends in a suppressed finalizer, since the child is already the
    // acceptance's latest round. Run the gate that died, so the child is
    // judged and its finalizer collapses this parent. The evidence and
    // `verifying` claims inside the gate are CAS-guarded against overlapping
    // sweeps; the parent keeps its claim until then.
    if (strandedRound?.stage === 'pre-judging') {
      const child = await operationModel.findById(strandedRound.operationId);
      const deliverable = await resolveFinalDeliverable(
        db,
        run.userId,
        { operationId: strandedRound.operationId, topicId: child?.topicId ?? undefined },
        workspaceId,
      );
      const params = {
        deliverable,
        goal: strandedRound.goal,
        operationId: strandedRound.operationId,
      };
      await (strandedRound.status === 'collecting_evidence'
        ? runVerifyAfterEvidenceSubmission(db, run.userId, params, workspaceId)
        : runVerifyOnCompletion(db, run.userId, params, workspaceId));
      log(
        're-drove %s repair round %s of run %s (op %s)',
        strandedRound.status,
        strandedRound.operationId,
        run.id,
        operationId,
      );
      return 'redriven';
    }

    // Stale claim, no live child: retake it via CAS. Losing it means a
    // concurrent delivery got here first.
    if (!(await runModel.reclaimRepairing(run.id))) return 'skipped';

    // Recompute re-derives the verdict from the on-disk results — the failed
    // checks are all terminal (that is what made this run repair-eligible) —
    // and the finalizer reaches `maybeAutoRepair` again, spawning a fresh
    // repair round for the same failures. A round a later round superseded
    // only gets its rollup, like every other sweep path: its task now waits on
    // the later round, and driving it from here would pause the task under
    // that round's feet.
    await new VerifyStatusService(db, run.userId, workspaceId).recompute(operationId);
    if (await isLatestRound(db, run)) {
      await finalizeVerifyRun(db, run.userId, operationId, {}, workspaceId);
    } else {
      // Skipping the finalizer also skips `triggerAutoRepair`'s superseded
      // branch, which is what marks a failed round's repair as declined. Without
      // that outcome the card keeps reading the failure as awaiting repair, so
      // record it here — the repair it was waiting on is never coming.
      const recomputed = await runModel.findByOperation(operationId);
      if (recomputed?.status === 'failed') await runModel.recordAutoRepair(run.id, 'declined');
    }
    log('reclaimed abandoned repair claim on run %s (op %s)', run.id, operationId);
    return 'settled';
  }

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

  const operationModel = new AgentOperationModel(db, run.userId, workspaceId);
  const latest = await isLatestRound(db, run);
  let redrive = false;

  if (outstanding.length > 0) {
    if (now.getTime() - run.updatedAt.getTime() < VERIFY_ABANDONED_MS) return 'skipped';

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

    redrive = latest && (await canRedrive(run, outstanding, byItem, operationModel));
  }

  // Committed to acting — take the lease first. Everything below has side effects
  // beyond this run: `finalizeVerifyRun` spawns the repair round, and two
  // overlapping sweep deliveries reaching it would race the recompute, the
  // finalizer and `triggerAutoRepair`'s own repair-round claim against the same
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

  if (redrive) {
    // Stamped before judging so a re-drive that dies the same way is not
    // re-driven forever: the next tick sees the stamp and closes it as errored.
    await new VerifyRunModel(db, run.userId, workspaceId).recordVerifierRedrive(run.id, now);
    const builder = await operationModel.findById(operationId);
    const deliverable = await resolveFinalDeliverable(
      db,
      run.userId,
      { operationId, topicId: builder?.topicId ?? undefined },
      workspaceId,
    );
    await redriveClaimedVerification(db, run.userId, { deliverable, operationId }, workspaceId);
    log('re-drove run %s (op %s): no verifier had started', run.id, operationId);
    return 'redriven';
  }

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
  // which is the whole point: the goal has been waiting on this verdict. Not for
  // a superseded round, though: its task now waits on the later round, and
  // driving it from here would pause the task under that round's feet.
  if (latest) await finalizeVerifyRun(db, run.userId, operationId, {}, workspaceId);

  const action = outstanding.length > 0 ? 'abandoned' : 'settled';
  log('recovered run %s (op %s) as %s', run.id, operationId, action);
  return action;
};

/** Verify-run states in which a round's judging is still underway. */
const JUDGING_RUN_STATUSES = new Set(['repairing', 'verifying']);
/**
 * States a finished repair child passes through on its way to judging. They are
 * not swept for a child round, so they only count as live while recent —
 * otherwise a completion hook that never fired would pin the parent forever.
 */
const PRE_JUDGING_RUN_STATUSES = new Set(['collecting_evidence', 'planned']);
/**
 * States a child round has reached once its rollup is recomputed. Its finalizer
 * still has to run after that write, and it is what collapses the parent's
 * claim, so a recent one keeps the claim until the finalizer grace runs out.
 */
const SETTLED_RUN_STATUSES = new Set(['errored', 'failed', 'passed']);

/**
 * Whether a repair child still owns its parent's settlement: the repair agent
 * itself is running, its round is still being judged or finalized, or one of
 * its verifiers is still working. A `verifying` / `repairing` child round
 * counts however old it is — the sweep recovers that round on its own, and its
 * finalizer collapses this parent. A child round that just settled counts for
 * {@link VERIFY_ROLLUP_GRACE_MS}: its finalizer runs right after the rollup
 * write and collapses this parent. Still `repairing` after the grace means that
 * finalizer died, and the sweep runs it (see {@link findStrandedRepairRound}).
 */
const isRepairChainLive = async (
  child: { id: string; status: AgentOperationStatus },
  operationModel: AgentOperationModel,
  runModel: VerifyRunModel,
  now: Date,
): Promise<boolean> => {
  if (isAgentOperationInFlight(child.status)) return true;

  const childRun = await runModel.findByOperation(child.id);
  if (childRun?.status) {
    if (JUDGING_RUN_STATUSES.has(childRun.status)) return true;
    const age = now.getTime() - childRun.updatedAt.getTime();
    if (PRE_JUDGING_RUN_STATUSES.has(childRun.status) && age < VERIFY_ABANDONED_MS) return true;
    if (SETTLED_RUN_STATUSES.has(childRun.status) && age < VERIFY_ROLLUP_GRACE_MS) return true;
  }

  const verifiers = await operationModel.listOperationTree(child.id);
  return verifiers.some(
    (verifier) => verifier.id !== child.id && isAgentOperationInFlight(verifier.status),
  );
};

interface StrandedRepairRound {
  goal: string;
  operationId: string;
  /**
   * `settled`: the round has its rollup but its finalizer died.
   * `pre-judging`: the repair finished (`done`) but its round never reached
   * judging — a completion or evidence hook died.
   */
  stage: 'pre-judging' | 'settled';
  status: string;
}

/**
 * A repair round of this run whose own settlement died, and that is still the
 * acceptance's latest round. Called once {@link isRepairChainLive} cleared
 * every child, so a round here is past its grace: a settled one past
 * {@link VERIFY_ROLLUP_GRACE_MS}, a pre-judging one past
 * {@link VERIFY_ABANDONED_MS}. A pre-judging round counts only when the repair
 * operation finished successfully and the round has a confirmed plan to judge;
 * a failed repair's round is swept on its own (`settleFailedRepair`). A round a
 * later round superseded is left to the reclaim path: finishing it would
 * decline a repair that already happened.
 */
const findStrandedRepairRound = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  repairChildren: { id: string; status: AgentOperationStatus }[],
  runModel: VerifyRunModel,
): Promise<StrandedRepairRound | undefined> => {
  for (const child of repairChildren) {
    const childRun = await runModel.findByOperation(child.id);
    if (!childRun?.status) continue;
    let stage: StrandedRepairRound['stage'];
    if (SETTLED_RUN_STATUSES.has(childRun.status)) stage = 'settled';
    else if (
      PRE_JUDGING_RUN_STATUSES.has(childRun.status) &&
      child.status === 'done' &&
      childRun.planConfirmedAt &&
      childRun.plan?.length
    )
      stage = 'pre-judging';
    else continue;
    // Evidence/verifier children also hang off this operation; only a round of
    // the same acceptance is a repair (the check `settleFailedRepair` applies).
    if ((childRun.acceptanceId ?? null) !== (run.acceptanceId ?? null)) continue;
    if (await isLatestRound(db, childRun))
      return { goal: childRun.goal ?? '', operationId: child.id, stage, status: childRun.status };
  }
};

/** Whether no later round of the same acceptance superseded this one. */
const isLatestRound = async (db: LobeChatDatabase, run: VerifyRunItem): Promise<boolean> => {
  if (!run.acceptanceId) return true;
  const rounds = await new VerifyRunModel(
    db,
    run.userId,
    run.workspaceId ?? undefined,
  ).listByAcceptance(run.acceptanceId);
  return rounds.every((round) => (round.roundIndex ?? 0) <= (run.roundIndex ?? 0));
};

/**
 * Whether a stalled latest round should be judged again rather than closed as
 * errored. Only when nothing was ever judged (no outstanding check reached a
 * verifier), the builder run finished successfully, and the round was not
 * re-driven before.
 */
const canRedrive = async (
  run: VerifyRunItem,
  outstanding: VerifyCheckItem[],
  byItem: Map<string, { verifierOperationId: string | null }>,
  operationModel: AgentOperationModel,
): Promise<boolean> => {
  if (run.metadata?.verifierRedrivenAt) return false;
  if (outstanding.some((item) => byItem.get(item.id)?.verifierOperationId)) return false;

  const builder = await operationModel.findById(run.operationId!);
  return builder?.status === 'done';
};

/**
 * The builder's final reply, read back the way the completion gate received it:
 * the run's delivery-checker card hangs off the assistant message that
 * completion carried.
 */
const resolveFinalDeliverable = async (
  db: LobeChatDatabase,
  userId: string,
  { operationId, topicId }: { operationId: string; topicId?: string },
  workspaceId?: string,
): Promise<string> => {
  const messageModel = new MessageModel(db, userId, workspaceId);
  const card = await messageModel.findVerifyMessageByOperationId(operationId, topicId);
  if (!card?.parentId) return '';

  const reply = await messageModel.findById(card.parentId);
  return typeof reply?.content === 'string' ? reply.content : '';
};
