import type { AcceptanceGroupFeedback } from '@lobechat/types';

import type { AcceptanceBundle } from '@/services/verify';

import type { AcceptanceCheck, AcceptanceCheckReviewEntry, AcceptanceEvidence } from './types';

export const collectGroupFeedback = (
  rounds: AcceptanceBundle['rounds'],
): AcceptanceGroupFeedback[] =>
  rounds.flatMap((round) =>
    (round.run.decisionDetail?.groupFeedback ?? []).map((entry) => ({
      ...entry,
      roundIndex: round.run.roundIndex ?? 0,
    })),
  );

export const splitCheckReviews = (
  check: AcceptanceCheck,
): { activeReview?: AcceptanceCheckReviewEntry; historyReviews: AcceptanceCheckReviewEntry[] } => {
  const activeReview =
    check.userReview && !check.userReview.stale ? check.reviews.at(-1) : undefined;

  return {
    activeReview,
    historyReviews: check.reviews.filter((review) => review !== activeReview),
  };
};

export const historicalEvidenceContext = (
  check: AcceptanceCheck,
  evidenceId: string | null | undefined,
): { evidence: AcceptanceEvidence; roundIndex: number } | undefined => {
  if (!evidenceId || check.evidence.some((evidence) => evidence.id === evidenceId))
    return undefined;
  const step = check.timeline.find((entry) =>
    entry.evidence.some((evidence) => evidence.id === evidenceId),
  );
  const evidence = step?.evidence.find((item) => item.id === evidenceId);
  return step && evidence ? { evidence, roundIndex: step.roundIndex } : undefined;
};
