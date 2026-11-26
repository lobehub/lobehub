import {
  ACCEPTANCE_REVIEW_ERRORED_ERROR,
  VERIFICATION_UNJUDGEABLE_ERROR,
} from '@lobechat/const/goal';
import type {
  GoalGraphSnapshot,
  GoalTickResult,
  TaskItem,
  VerifyRunMetadata,
} from '@lobechat/types';

import { AcceptanceModel } from '@/database/models/acceptance';
import { VerifyRunModel } from '@/database/models/verifyRun';

import { driveTaskFromVerify } from '../verify/settle';
import type { GoalServiceContext } from './GoalService/types';

/** A gate reads in a card; the full review stays on the round it judged. */
const MAX_REVIEW_DETAIL_LENGTH = 600;

type ReviewContext = Pick<GoalServiceContext, 'db' | 'userId' | 'workspaceId'>;

/** The newest round the Goal's Acceptance review has spoken on. */
const latestReviewedRound = async (ctx: ReviewContext, taskId: string) => {
  const acceptance = await new AcceptanceModel(ctx.db, ctx.userId, ctx.workspaceId).findBySubject(
    'task',
    taskId,
  );
  if (!acceptance) return undefined;
  const rounds = await new VerifyRunModel(ctx.db, ctx.userId, ctx.workspaceId).listByAcceptance(
    acceptance.id,
  );
  return rounds.findLast((round) => !!(round.metadata as VerifyRunMetadata | null)?.goalReview);
};

/**
 * What a gate opened on a review that did not reach a verdict should say beyond
 * its fixed reason. The review recorded the actual cause on its round; without
 * this the owner sees that it failed and not why. Only a review that could not
 * run offers a re-run: an undecidable criterion stays undecidable however often
 * it is read. A failed read only costs the detail, never the gate.
 */
export const readReviewGate = async (
  ctx: ReviewContext,
  task: Pick<TaskItem, 'error' | 'id'>,
): Promise<{ detail?: string; retryReview?: boolean }> => {
  if (
    task.error !== ACCEPTANCE_REVIEW_ERRORED_ERROR &&
    task.error !== VERIFICATION_UNJUDGEABLE_ERROR
  )
    return {};
  const retryReview = task.error === ACCEPTANCE_REVIEW_ERRORED_ERROR;
  try {
    const round = await latestReviewedRound(ctx, task.id);
    const feedback = (round?.metadata as VerifyRunMetadata | null)?.goalReview?.feedback?.trim();
    return {
      ...(feedback ? { detail: feedback.slice(0, MAX_REVIEW_DETAIL_LENGTH) } : {}),
      retryReview,
    };
  } catch (error) {
    console.error('[goal] failed to read the review behind a gate:', error);
    return { retryReview };
  }
};

/**
 * Run the Acceptance review again on the delivery it could not judge.
 *
 * The compare-and-swap makes overlapping advances run it once. The Task goes
 * back to `running` with its delivered topic, the state the coordinator already
 * reads as "being settled", and the round's drive is reopened so the ordinary
 * settle path judges it: a pass completes the Task, a rejection repairs it, and
 * another outage opens the gate again. A round that can no longer be found has
 * nothing to re-judge, so the Task falls back to an ordinary new attempt.
 */
export const retryAcceptanceReview = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
): Promise<GoalTickResult> => {
  const result = (message: string): GoalTickResult => ({
    goalId: graph.goal.id,
    message,
    nodeId,
    outcome: 'waiting_external',
    taskId: task.id,
  });

  const round = await latestReviewedRound(ctx, task.id);
  const review = (round?.metadata as VerifyRunMetadata | null)?.goalReview;
  if (!round?.operationId || round.status !== 'passed' || review?.status !== 'errored') {
    await ctx.taskModel.updateStatusIfCurrent(task.id, 'paused', 'backlog', { error: null });
    return result('No reviewable delivery was found; the Task starts a new attempt');
  }

  const claimed = await ctx.taskModel.updateStatusIfCurrent(task.id, 'paused', 'running', {
    error: null,
  });
  if (!claimed) return result('Task state changed before the review could run again');

  await new VerifyRunModel(ctx.db, ctx.userId, ctx.workspaceId).releaseTaskDrive(round.id);
  await driveTaskFromVerify(ctx.db, ctx.userId, round.operationId, ctx.workspaceId);
  return result('Acceptance review ran again');
};
