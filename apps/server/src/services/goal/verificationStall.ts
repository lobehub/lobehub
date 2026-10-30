import type { VerifyCheckItem, VerifyRunMetadata } from '@lobechat/types';

import { AcceptanceModel } from '@/database/models/acceptance';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { VerifyCheckResultItem, VerifyRunItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

/** Consecutive attempts that may fail the same way before a person is asked. */
export const REPEATED_FAILURE_LIMIT = 2;

type StallRound = Pick<VerifyRunItem, 'createdAt' | 'id' | 'metadata' | 'plan' | 'status'>;
type StallResult = Pick<VerifyCheckResultItem, 'checkItemId' | 'status' | 'verdict'>;

/**
 * What a delivered attempt fell short on, or `undefined` when it did not fail on
 * its content (it passed, or the verifier could not run).
 *
 * - A failed round: the required checks it did not pass, by plan item id. Every
 *   attempt of a Task re-instantiates the same plan item ids, so two attempts
 *   that left the same checks open read the same.
 * - A round that passed verification but the Goal review sent back: the
 *   review's feedback, verbatim. A deterministic rejection ("Submit current
 *   evidence for this required check") repeats word for word; a model's own
 *   comments rarely do, so those stay bounded by the attempt budget alone.
 */
export const failureSignature = (round: StallRound, results: StallResult[]): string | undefined => {
  const review = (round.metadata as VerifyRunMetadata | null)?.goalReview;
  if (round.status === 'passed') {
    return review?.status === 'rejected' ? `review:${review.feedback.trim()}` : undefined;
  }
  if (round.status !== 'failed') return;

  const resultByItem = new Map(results.map((result) => [result.checkItemId, result]));
  const open = ((round.plan ?? []) as VerifyCheckItem[])
    .filter((item) => item.required !== false)
    .filter((item) => {
      const result = resultByItem.get(item.id);
      return (result?.verdict ?? result?.status) !== 'passed';
    })
    // Named like the acceptance union names them: a generated first plan keeps
    // its own item ids, while every Goal retry is re-planned from the union
    // under the criterion id, so local ids differ between the first two attempts.
    .map((item) => (item.sourceFlowNode ? item.id : (item.sourceCriterionId ?? item.id)))
    .sort();
  return open.length > 0 ? `checks:${open.join(',')}` : undefined;
};

/**
 * Whether the Task's latest attempts all failed verification the same way.
 *
 * A failed verification used to start the next attempt straight away until the
 * attempt budget ran out, even when each attempt was sent back for the same
 * thing — the retries could not change the outcome, they only spent the budget
 * and left the person a gate that said nothing about why.
 *
 * Only the round that settled an attempt counts (it carries `taskDrivenAt`); the
 * repair rounds inside one attempt are that attempt's own business. A person's
 * answer to a gate starts the count again, so their Retry gets its own attempts.
 */
export const isVerificationStalled = (
  rounds: { results: StallResult[]; round: StallRound }[],
  since?: Date,
): boolean => {
  const settled = rounds.filter(
    ({ round }) =>
      !!(round.metadata as { taskDrivenAt?: string } | null)?.taskDrivenAt &&
      (!since || new Date(round.createdAt) > since),
  );
  const recent = settled.slice(-REPEATED_FAILURE_LIMIT);
  if (recent.length < REPEATED_FAILURE_LIMIT) return false;
  const signatures = recent.map(({ results, round }) => failureSignature(round, results));
  return signatures.every((signature) => !!signature && signature === signatures[0]);
};

/** Reads the Task's acceptance rounds and applies {@link isVerificationStalled}. */
export const readVerificationStall = async (
  db: LobeChatDatabase,
  owner: { userId: string; workspaceId?: string },
  taskId: string,
  since?: Date,
): Promise<boolean> => {
  const acceptance = await new AcceptanceModel(db, owner.userId, owner.workspaceId).findBySubject(
    'task',
    taskId,
  );
  if (!acceptance) return false;
  const runs = await new VerifyRunModel(db, owner.userId, owner.workspaceId).listByAcceptance(
    acceptance.id,
  );
  if (runs.length < REPEATED_FAILURE_LIMIT) return false;
  const results = await new VerifyCheckResultModel(db, owner.userId, owner.workspaceId).listByRuns(
    runs.map((run) => run.id),
  );
  return isVerificationStalled(
    runs.map((round) => ({
      results: results.filter((result) => result.verifyRunId === round.id),
      round,
    })),
    since,
  );
};
