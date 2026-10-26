import type {
  AcceptanceAttachment,
  AcceptanceCheckReviewAction,
  AcceptanceReviewAnnotation,
  VerifyCheckDecisionDetail,
} from '@lobechat/types';

import type { AcceptanceCheckRow } from './acceptanceCheckUnion';

/** The fields of a result row the overlay reads: the decision stamped on it. */
export interface ReviewOverlayResult {
  completedAt: Date | null;
  createdAt: Date;
  id: string;
  userDecision: string | null;
  userDecisionDetail: VerifyCheckDecisionDetail | null;
}

// ============================================
// User review overlay — the per-check human verdict layered onto the union.
// An accept or ignore is sticky across rounds; a reject binds to the round it
// judged and demotes to iteration history once a newer round lands.
// ============================================

/** The standing user verdict on one union row, derived from its result rows. */
export interface AcceptanceCheckUserReview {
  action: AcceptanceCheckReviewAction;
  annotations?: AcceptanceReviewAnnotation[];
  /** Attachments backing a reject, resolved to URLs by the bundle read. */
  attachments?: AcceptanceAttachment[];
  comment?: string;
  createdAt: string;
  roundIndex: number;
  /**
   * A reject made against a round older than the current one — the feedback
   * was (or is being) consumed by a newer round, so the check is back to
   * awaiting the user's confirmation instead of standing rejected.
   */
  stale: boolean;
}

/**
 * One user decision on one executed step of a check, projected out of the
 * result rows (`user_decision` + `user_decision_detail`) — no dedicated store:
 * each round's row keeps the decision the user made on THAT round's evidence.
 */
export interface AcceptanceCheckReviewEvent {
  action: AcceptanceCheckReviewAction;
  annotations?: AcceptanceReviewAnnotation[];
  /** Attachments backing the reject, resolved to URLs by the bundle read. */
  attachments?: AcceptanceAttachment[];
  comment?: string;
  /** When the decision was made (ISO 8601; falls back to the row's timestamps). */
  createdAt: string;
  /** Who decided (user id). Absent on legacy rows, which only the owner could write. */
  decidedBy?: string;
  /** Uploaded/pasted screenshots backing the reject (FKs to files). */
  fileIds?: string[];
  /** The result row the decision is stamped on. */
  id: string;
  roundIndex: number;
}

export interface AcceptanceCheckReviewOverlay {
  /** The full review trail for this check, oldest first — the iteration history input. */
  reviews: AcceptanceCheckReviewEvent[];
  /** The newest review, with its staleness resolved against the current round. */
  userReview?: AcceptanceCheckUserReview;
}

/**
 * Project a union row's review trail + standing user verdict from its result
 * rows. Superseded generations' decisions ride along automatically — the union
 * already folded their results into this row's timeline.
 */
export const buildCheckReviewOverlay = (
  check: Pick<AcceptanceCheckRow, 'timeline'> & Partial<Pick<AcceptanceCheckRow, 'planItem'>>,
  resultsById: Map<string, ReviewOverlayResult>,
  currentRoundIndex: number,
): AcceptanceCheckReviewOverlay => {
  const reviews: AcceptanceCheckReviewEvent[] = [];
  for (const entry of check.timeline) {
    const result = resultsById.get(entry.resultId);
    const decision = result?.userDecision;
    if (
      !result ||
      (decision !== 'accepted' && decision !== 'rejected' && decision !== 'overridden')
    )
      continue;
    const detail = result.userDecisionDetail ?? undefined;
    reviews.push({
      action: decision === 'accepted' ? 'accept' : decision === 'overridden' ? 'ignore' : 'reject',
      annotations: detail?.annotations,
      comment: detail?.comment,
      createdAt: detail?.decidedAt ?? (result.completedAt ?? result.createdAt)?.toISOString() ?? '',
      decidedBy: detail?.decidedBy,
      fileIds: detail?.fileIds,
      id: result.id,
      // A carried-forward check is judged at the CURRENT round even though its
      // evidence row belongs to an older one — the detail records that round.
      roundIndex: detail?.roundIndex ?? entry.roundIndex,
    });
  }
  // ISO strings order lexically; ties (legacy rows without decidedAt) keep round order.
  reviews.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.roundIndex - b.roundIndex);

  const latest = reviews.at(-1);
  if (!latest) return { reviews };
  return {
    reviews,
    userReview: {
      action: latest.action,
      annotations: latest.annotations,
      comment: latest.comment,
      createdAt: latest.createdAt,
      roundIndex: latest.roundIndex,
      stale:
        (Boolean(check.planItem?.sourceFlowNode) || latest.action === 'reject') &&
        latest.roundIndex < currentRoundIndex,
    },
  };
};
