import type {
  AcceptanceCheckReviewAction,
  AcceptanceRejectIntent,
  AcceptanceReviewAnnotation,
  ReviewProposalOutcome,
  VerifyCheckDecisionDetail,
} from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyReviewPredictionModel } from '@/database/models/verifyReviewPrediction';
import type { VerifyCheckResultItem } from '@/database/schemas/verify';

import { computeFalseFlags } from '../feedbackService';
import { type AcceptanceCheckRow, buildAcceptanceCheckUnion } from './checkUnion';
import type { AcceptanceServiceDeps } from './deps';

const log = debug('lobe-server:verify-acceptance');

const CHECK_DECISION_WRITE_CONCURRENCY = 10;

/**
 * Record the user's verdict on one or more union checks (a group-level
 * "accept all" is just many ids). Stamps `user_decision` +
 * `user_decision_detail` on each check's FINAL result row — the same data
 * flywheel every other decision path writes (FP/FN flags included). Unlike
 * the aggregate-level accept/reject, a per-check review is allowed at any
 * lifecycle state — confirming a check mid-chain is exactly the point.
 */
export const reviewChecks = async (
  deps: AcceptanceServiceDeps,
  acceptanceId: string,
  input: {
    action: AcceptanceCheckReviewAction;
    annotations?: AcceptanceReviewAnnotation[];
    checkItemIds: string[];
    comment?: string;
    fileIds?: string[];
    /** Recorded when this decision answered a model proposal. */
    proposal?: Omit<ReviewProposalOutcome, 'respondedAt'>;
    /** Which of the three jobs a reject is doing; absent means unclassified. */
    rejectIntent?: AcceptanceRejectIntent;
  },
): Promise<{ resultIds: string[] }> => {
  const acceptance = await deps.acceptanceModel.findById(acceptanceId);
  if (!acceptance) throw new Error(`Acceptance "${acceptanceId}" not found`);

  const { results, runs } = await deps.loadRounds(acceptanceId);

  // Reviews address union rows — resolve each id (or a superseded alias) to
  // its row, so a stale client can't stamp junk ids.
  const resultsByRun = new Map<string, VerifyCheckResultItem[]>();
  for (const result of results) {
    const bucket = resultsByRun.get(result.verifyRunId!) ?? [];
    bucket.push(result);
    resultsByRun.set(result.verifyRunId!, bucket);
  }
  const checks = buildAcceptanceCheckUnion(
    runs.map((run) => ({ results: resultsByRun.get(run.id) ?? [], run })),
  );
  const rowById = new Map<string, AcceptanceCheckRow>();
  for (const check of checks) {
    rowById.set(check.id, check);
    for (const oldId of check.supersededIds) rowById.set(oldId, check);
  }

  const unknown = input.checkItemIds.filter((id) => !rowById.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown check item(s): ${unknown.join(', ')}`);
  }

  // The decision is stamped on evidence — a never-executed check has no
  // result row to judge, so it cannot be reviewed yet.
  const targets = new Map<string, VerifyCheckResultItem>();
  const notExecuted: string[] = [];
  for (const id of input.checkItemIds) {
    const row = rowById.get(id)!;
    if (row.result) targets.set(row.result.id, row.result);
    else notExecuted.push(id);
  }
  if (notExecuted.length > 0) {
    throw new Error(`Check(s) never executed — nothing to review: ${notExecuted.join(', ')}`);
  }

  const decision =
    input.action === 'accept' ? 'accepted' : input.action === 'ignore' ? 'overridden' : 'rejected';
  const currentRoundIndex = runs.at(-1)?.roundIndex ?? 0;
  const detail: VerifyCheckDecisionDetail = {
    decidedAt: new Date().toISOString(),
    decidedBy: deps.actorUserId,
    roundIndex: currentRoundIndex,
    ...(input.comment ? { comment: input.comment } : {}),
    ...(input.annotations?.length ? { annotations: input.annotations } : {}),
    ...(input.fileIds?.length ? { fileIds: input.fileIds } : {}),
    // Only meaningful on a reject — an accept has no intent to classify.
    ...(input.rejectIntent && input.action === 'reject'
      ? { rejectIntent: input.rejectIntent }
      : {}),
    ...(input.proposal
      ? { proposal: { ...input.proposal, respondedAt: new Date().toISOString() } }
      : {}),
  };

  // One transaction for the decision AND the proposal's answer. Written
  // separately, a failing second write left the check rejected while its
  // prediction stayed unanswered — and the decision then HIDES the proposal,
  // so nothing could ever reconcile the pair again. Agreement analysis reads
  // those two rows as a matched set; a durable split is worse than failing.
  await deps.db.transaction(async (tx) => {
    const resultModel = new VerifyCheckResultModel(tx, deps.userId, deps.workspaceId);

    // `checkItemIds` is request-supplied (a group-level accept can carry many),
    // so the per-row writes are capped rather than fanned out unbounded.
    await pMap(
      [...targets.values()],
      (result) => {
        const { isFalsePositive, isFalseNegative } = computeFalseFlags(result.verdict, decision);
        return resultModel.update(result.id, {
          isFalseNegative,
          isFalsePositive,
          userDecision: decision,
          userDecisionDetail: detail,
        });
      },
      { concurrency: CHECK_DECISION_WRITE_CONCURRENCY },
    );

    if (input.proposal) {
      const answered = await new VerifyReviewPredictionModel(
        tx,
        deps.userId,
        deps.workspaceId,
      ).adjudicate(input.proposal.predictionId, {
        adjudication: input.proposal.adjudication,
        edit: input.proposal.edit,
      });
      // A zero-row update means the id was wrong or not ours; committing the
      // decision alone would produce exactly the split this transaction exists
      // to prevent.
      if (!answered) throw new Error(`Proposal "${input.proposal.predictionId}" not found`);
    }
  });

  log('acceptance %s: %d check result(s) marked %s', acceptanceId, targets.size, decision);
  return { resultIds: [...targets.keys()] };
};
