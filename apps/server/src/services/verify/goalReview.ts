import { isDraftVerifyRun } from '@lobechat/const/verify';
import type { VerifyRunMetadata } from '@lobechat/types';

import { GoalModel } from '@/database/models/goal';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService, buildAcceptanceCheckUnion } from './acceptanceService';
import { mapWithConcurrency } from './concurrency';
import { resolveGoalReviewModelConfig } from './goalReviewModelConfig';
import { REVIEW_PREDICT_CONCURRENCY, VerifyReviewPredictorService } from './reviewPredictor';

/**
 * The startup failures this review can name back to a person. Everything else that
 * can throw in here — the database, the acceptance and evidence reads, the model
 * lookup — could carry SQL, identifiers or provider diagnostics, and the feedback
 * string is persisted on the run and quoted into the escalation, so those stay in
 * the server log only.
 */
const REVIEW_BLOCKERS = {
  acceptanceMissing: 'Goal Acceptance was not found',
  noAcceptance: 'Goal delivery has no Acceptance',
  noRequiredChecks: 'Goal Acceptance has no required checks',
} as const;

const namedBlocker = (error: unknown): string | undefined => {
  const message = error instanceof Error ? error.message : undefined;
  return Object.values(REVIEW_BLOCKERS).find((blocker) => blocker === message);
};

/** Called under the verify run's task-drive claim, before completing a Goal task. */
export const reviewGoalDelivery = async (
  db: LobeChatDatabase,
  userId: string,
  taskId: string,
  operationId: string,
  workspaceId?: string,
): Promise<VerifyRunMetadata['goalReview']> => {
  const goal = await new GoalModel(db, userId, workspaceId).findByGraphTask(taskId);
  if (!goal) return;

  const runModel = new VerifyRunModel(db, userId, workspaceId);
  const run = await runModel.findByOperation(operationId);
  const review: NonNullable<VerifyRunMetadata['goalReview']> = {
    feedback: '',
    predictionIds: [],
    status: 'passed',
  };
  try {
    if (!run?.acceptanceId) throw new Error(REVIEW_BLOCKERS.noAcceptance);
    const service = new AcceptanceService(db, userId, workspaceId);
    const acceptance = await service.acceptanceModel.findById(run.acceptanceId);
    if (!acceptance) throw new Error(REVIEW_BLOCKERS.acceptanceMissing);
    const { results, runs } = await service.loadRounds(acceptance.id);
    // An unconfirmed draft was never frozen, so its checks are not part of the
    // contract being judged. It can sit behind an executed round — an abandoned
    // draft, or one a CLI-driven verification was appended past — and its
    // result-less items would otherwise each read as missing evidence and turn a
    // passing delivery into a rejection.
    const checks = buildAcceptanceCheckUnion(
      runs
        .filter((round) => !isDraftVerifyRun(round))
        .map((round) => ({
          results: results.filter((result) => result.verifyRunId === round.id),
          run: round,
        })),
    ).filter((check) => check.required);
    if (!checks.length) throw new Error(REVIEW_BLOCKERS.noRequiredChecks);

    const evidenceModel = new VerifyEvidenceModel(db, userId, workspaceId);
    const evidence = await Promise.all(
      checks.map((check) =>
        check.result ? evidenceModel.listByCheckResult(check.result.id) : Promise.resolve([]),
      ),
    );
    let modelConfigPromise: ReturnType<typeof resolveGoalReviewModelConfig> | undefined;
    const getModelConfig = () => {
      modelConfigPromise ??= resolveGoalReviewModelConfig(
        db,
        userId,
        {
          requiresVision: evidence.flat().some((item) => ['screenshot', 'gif'].includes(item.type)),
          taskId,
          verifierAgentId: acceptance.config?.verifierAgentId,
        },
        workspaceId,
      );
      return modelConfigPromise;
    };

    const predictor = new VerifyReviewPredictorService(db, userId, workspaceId);
    const feedback: string[] = [];
    // Checks are judged concurrently, so the aggregate has to be order
    // independent: take the most blocking outcome seen rather than letting the
    // last writer win. `rejected` outranks `unjudgeable` because one genuinely
    // short check makes another attempt worth paying for, while an undecidable
    // check on its own makes every further attempt a repeat.
    const escalate = (next: NonNullable<VerifyRunMetadata['goalReview']>['status']) => {
      const rank = { errored: 3, passed: 0, rejected: 2, unjudgeable: 1 } as const;
      if (rank[next] > rank[review.status]) review.status = next;
    };
    await mapWithConcurrency(checks, REVIEW_PREDICT_CONCURRENCY, async (check) => {
      if (!check.result || check.carriedFromRound !== undefined) {
        escalate('rejected');
        feedback.push(`${check.title}: Submit current evidence for this required check.`);
        return;
      }
      if (check.result.userDecision === 'accepted' || check.result.userDecision === 'overridden')
        return;
      if (check.result.userDecision === 'rejected') {
        escalate('rejected');
        feedback.push(
          `${check.title}: ${check.result.userDecisionDetail?.comment ?? 'Rejected by the user.'}`,
        );
        return;
      }
      const modelConfig = await getModelConfig();
      if (!modelConfig) {
        escalate('errored');
        feedback.push(
          'Configure an available model on the Acceptance verifier agent and retry the review.',
        );
        return;
      }
      const checkResultId = check.result.id;
      const judge = () =>
        predictor
          .predict({
            checkResultId,
            includeTextEvidence: true,
            instructionDocumentId: check.planItem?.documentId,
            modelConfig,
            requirement: acceptance.requirement,
            surface: check.surface,
          })
          .catch((error) => {
            console.error('[goal-review] Check review failed:', error);
            return null;
          });
      let prediction = await judge();
      // A check whose review could not run is retried once, on its own, which
      // absorbs a dropped connection. Retrying the whole review instead re-asks
      // every other check, and a nondeterministic second opinion can overwrite a
      // first-pass rejection and let the delivery through.
      if (!prediction || prediction.status === 'errored') prediction = await judge();
      if (prediction) review.predictionIds.push(prediction.id);
      if (prediction?.status === 'judged' && prediction.action === 'accept') return;
      if (prediction?.status === 'errored' || !prediction) {
        escalate('errored');
      } else if (prediction.status === 'judged' && prediction.action === 'unjudgeable') {
        // The criterion asks for something no reader can confirm. Re-delivering
        // cannot change that, so this must not read as a rejected delivery.
        escalate('unjudgeable');
      } else escalate('rejected');
      feedback.push(
        `${check.title}: ${prediction?.comment ?? prediction?.statusReason ?? 'Review could not reach a decision.'}`,
      );
      if (prediction?.annotations?.length) feedback.push(JSON.stringify(prediction.annotations));
    });
    review.feedback = feedback.join('\n');
  } catch (error) {
    console.error('[goal-review] Acceptance review failed:', error);
    review.status = 'errored';
    // The reason has to travel: this string is what the escalation quotes back to
    // the person who has to unblock the Goal. A single canned sentence sent every
    // failure — a missing Acceptance link included — to look like an unconfigured
    // review model, which is a different problem with a different fix.
    const blocker = namedBlocker(error);
    review.feedback = blocker
      ? `Automatic Acceptance review could not complete: ${blocker}. Resolve the cause and retry the review before advancing.`
      : 'Automatic Acceptance review could not complete (internal error); the server log holds the reason. Retry the review before advancing.';
  }
  if (run) {
    // Preserve the task-drive claim and the run's existing policy/provenance.
    await runModel.setMetadata(run.id, { ...run.metadata, goalReview: review });
  }
  return review;
};
