import type { VerifyCheckItem } from '@lobechat/types';
import { buildCheckReviewOverlay } from '@lobechat/utils/verify/acceptanceReviewOverlay';

import type { VerifyCheckResultItem, VerifyRunItem } from '@/database/schemas/verify';

import { findUnresolvedSupersedes } from '../acceptanceMerge';
import { buildAcceptanceCheckUnion } from './checkUnion';
import type { AcceptanceServiceDeps } from './deps';

/** A run chained onto an acceptance, with anything the author should fix. */
export type AttachedRun = VerifyRunItem & {
  /** `supersedes` ids naming no check of this acceptance; they fold nothing. */
  unresolvedSupersedes?: string[];
};

/**
 * An accepted check is settled and its verdict is sticky: a later result on
 * the same id inherits the tick, so the round publishes green and the
 * reviewer is never told there is anything new to look at. That is only safe
 * while nothing writes to a settled check, which is what this enforces —
 * refusing the whole round rather than letting the write through, because a
 * partially attached round is harder to reason about than a rejected one.
 *
 * The escape hatch is a new check id: a criterion the reviewer has not ruled
 * on gets its own row and shows up unreviewed, which is what "there is more
 * to look at here" should look like.
 */
export const assertPlanLeavesAcceptedChecksAlone = async (
  deps: AcceptanceServiceDeps,
  run: VerifyRunItem,
  acceptanceId: string,
): Promise<void> => {
  // Every identity by which an incoming item could come to rest on an
  // existing row. The union keys rows by `sourceCriterionId ?? id`, and a
  // `supersedes` declaration folds the named row into this one — so comparing
  // physical ids alone lets both routes write into a settled row unblocked.
  const candidates = new Map<string, string>();
  for (const item of run.plan ?? []) {
    const logicalId = item.sourceFlowNode ? item.id : (item.sourceCriterionId ?? item.id);
    if (logicalId) candidates.set(logicalId, item.id);
    if (item.id) candidates.set(item.id, item.id);
    for (const superseded of item.supersedes ?? []) {
      if (superseded) candidates.set(superseded, item.id);
    }
  }
  if (candidates.size === 0) return;

  const runs = await deps.runModel.listByAcceptance(acceptanceId);
  if (runs.length === 0) return;

  const results = await deps.resultModel.listByRuns(runs.map((item) => item.id));
  const resultsById = new Map(results.map((result) => [result.id, result]));
  const resultsByRun = new Map<string, VerifyCheckResultItem[]>();
  for (const result of results) {
    if (!result.verifyRunId) continue;
    const bucket = resultsByRun.get(result.verifyRunId) ?? [];
    bucket.push(result);
    resultsByRun.set(result.verifyRunId, bucket);
  }

  const currentRoundIndex = runs.at(-1)?.roundIndex ?? 0;
  const checks = buildAcceptanceCheckUnion(
    runs.map((item) => ({ results: resultsByRun.get(item.id) ?? [], run: item })),
  );

  // Read the standing verdict exactly the way the page renders it, so the
  // rule cannot diverge from the tick the reviewer actually sees.
  const settled = checks.filter((check) => {
    const { userReview } = buildCheckReviewOverlay(check, resultsById, currentRoundIndex);
    return userReview?.action === 'accept' && !userReview.stale;
  });

  // A superseded generation's id is folded into its successor's row, so match
  // on both — re-running `old-id` after `new-id supersedes: [old-id]` was
  // accepted is the same write to the same settled row.
  const blocked = new Set<string>();
  for (const check of settled) {
    blocked.add(check.id);
    for (const superseded of check.supersededIds ?? []) blocked.add(superseded);
  }
  // Rows are keyed by criterion, but an author names a check by the plan item
  // id they wrote — in `supersedes` as much as in a re-run. Block those too.
  for (const { plan } of runs) {
    for (const item of (plan ?? []) as VerifyCheckItem[]) {
      const logicalId = item.sourceFlowNode ? item.id : (item.sourceCriterionId ?? item.id);
      if (blocked.has(logicalId)) blocked.add(item.id);
    }
  }

  // Report the plan item the author has to change, not the internal identity
  // it collided through — those can differ, and only the former is editable.
  const offenders = [
    ...new Set(
      [...candidates]
        .filter(([identity]) => blocked.has(identity))
        .map(([, planItemId]) => planItemId),
    ),
  ];
  if (offenders.length === 0) return;

  throw new Error(
    `Already accepted, so ${offenders.length === 1 ? 'this check' : 'these checks'} cannot take another result: ` +
      `${offenders.join(', ')}. An accepted check is settled — publish new work under a new check id instead.`,
  );
};

/**
 * Attach `unresolvedSupersedes` — `supersedes` ids of `source`'s plan that
 * name no check of the acceptance — to the run handed back to the caller.
 * The source run itself is excluded from the chain it is resolved against.
 */
export const withUnresolvedSupersedes = async (
  deps: AcceptanceServiceDeps,
  attached: VerifyRunItem,
  acceptanceId: string,
  source: VerifyRunItem = attached,
): Promise<AttachedRun> => {
  const plan = (source.plan ?? []) as VerifyCheckItem[];
  if (!plan.some((item) => item.supersedes?.length)) return attached;

  const priorRuns = (await deps.runModel.listByAcceptance(acceptanceId)).filter(
    (run) => run.id !== source.id,
  );
  // Results of the earlier rounds and of the source run itself: an executed
  // run may supersede one of its own result-only checks.
  const priorResults = await deps.resultModel.listByRuns([
    ...priorRuns.map((run) => run.id),
    source.id,
  ]);
  const unresolvedSupersedes = findUnresolvedSupersedes(
    plan,
    priorRuns,
    priorResults.map((result) => result.checkItemId),
  );
  return unresolvedSupersedes.length ? { ...attached, unresolvedSupersedes } : attached;
};
