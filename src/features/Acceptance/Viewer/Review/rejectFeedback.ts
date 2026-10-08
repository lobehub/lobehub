import type { AcceptanceAttachment, AcceptanceCommentItem } from '@lobechat/types';

import type { AcceptanceBundle } from '@/services/verify';

/**
 * Who wrote one piece of feedback.
 *
 * `unknown` is a real state, not a fallback: group notes record no author, and
 * claiming them for the reader would tell a teammate's note as their own.
 */
export interface RejectFeedbackAuthor {
  avatar?: string;
  kind: 'mine' | 'other' | 'unknown';
  /** Unset when the writer is known to be someone else but has no profile here. */
  name?: string;
}

/** One piece of feedback the repair agent will read alongside the reject reason. */
export interface RejectFeedbackItem {
  annotationCount?: number;
  attachments?: AcceptanceAttachment[];
  author: RejectFeedbackAuthor;
  createdAt: string;
  key: string;
  /** Where it hangs: `C3 title`, a group label, or a flow step. */
  scope?: string;
  text: string;
}

type BundleSource = Pick<AcceptanceBundle, 'acceptance' | 'author' | 'checks' | 'flows' | 'rounds'>;

interface CollectRejectFeedbackParams {
  bundle: BundleSource;
  comments: AcceptanceCommentItem[];
  viewer: { avatar?: string; id?: string; name: string };
}

interface Profile {
  avatar?: string;
  name: string;
}

/**
 * What the reject's repair prompt actually hands over. The prompt points the
 * agent at `lh acceptance feedback --actionable`, so the dialog previews the
 * same set, with the same predicates, instead of leaving the reviewer to guess
 * whether a teammate's comment or screenshot rides along. Keep each branch in
 * step with that command (apps/cli/src/commands/verifyAcceptance.ts and
 * acceptanceCommentFeedback.ts).
 */
export const collectRejectFeedback = ({
  bundle,
  comments,
  viewer,
}: CollectRejectFeedbackParams): RejectFeedbackItem[] => {
  const { acceptance, checks, flows = [], rounds } = bundle;
  const currentRoundIndex = rounds.at(-1)?.run.roundIndex ?? 0;

  // Names for user ids, from whatever this page already knows: the owner and
  // everyone in the discussion.
  const profiles = new Map<string, Profile>();
  if (bundle.author)
    profiles.set(bundle.author.id, {
      avatar: bundle.author.avatar || undefined,
      name: bundle.author.fullName || bundle.author.username || '',
    });
  for (const item of comments) {
    if (item.authorUserId && item.author.type === 'user')
      profiles.set(item.authorUserId, {
        avatar: item.author.avatar || undefined,
        name: item.author.fullName || item.author.username || '',
      });
  }

  /** A decision's writer; decisions without `decidedBy` predate it and were the owner's. */
  const decider = (decidedBy: string | null | undefined): RejectFeedbackAuthor => {
    const userId = decidedBy || acceptance.userId;
    if (viewer.id && userId === viewer.id)
      return { avatar: viewer.avatar || undefined, kind: 'mine', name: viewer.name };
    const profile = profiles.get(userId);
    return { avatar: profile?.avatar, kind: 'other', name: profile?.name || undefined };
  };

  const items: RejectFeedbackItem[] = [];

  const flowResultIds = new Set(
    flows.flatMap((flow) =>
      flow.versions.flatMap((version) =>
        version.runs.flatMap((run) => run.attempts.map((attempt) => attempt.checkResultId)),
      ),
    ),
  );

  // Check rejects: only the one standing as the check's latest, unconsumed verdict.
  for (const check of checks) {
    const latest = check.reviews.at(-1);
    const standing =
      check.userReview?.action === 'reject' &&
      !check.userReview.stale &&
      latest?.action === 'reject';
    if (!latest || !standing || flowResultIds.has(latest.id)) continue;
    items.push({
      annotationCount: latest.annotations?.length || undefined,
      attachments: latest.attachments,
      author: decider(latest.decidedBy),
      createdAt: latest.createdAt,
      key: `check-${latest.id}`,
      scope: `C${check.seq} ${check.title}`,
      text: latest.comment ?? '',
    });
  }

  // Flow rejects: the latest attempt per check, in the newest version's newest run.
  for (const flow of flows) {
    const version = flow.versions[0];
    const run = version?.runs[0];
    if (!version || !run) continue;
    const latestAttempt = new Map(run.attempts.map((attempt) => [attempt.checkItemId, attempt.id]));
    for (const attempt of run.attempts) {
      if (attempt.review !== 'rejected' || latestAttempt.get(attempt.checkItemId) !== attempt.id)
        continue;
      const node = version.nodes.find((entry) => entry.id === attempt.nodeId);
      items.push({
        annotationCount: attempt.reviewDetail?.annotations?.length || undefined,
        attachments: attempt.reviewAttachments,
        author: decider(attempt.reviewDetail?.decidedBy),
        createdAt: attempt.reviewDetail?.decidedAt ?? '',
        key: `flow-${attempt.id}`,
        scope: `${node?.title ?? ''} · #${attempt.sequence}`,
        text: attempt.reviewComment ?? '',
      });
    }
  }

  // Round-level reasons and group notes addressed to the current round.
  for (const round of rounds) {
    const roundIndex = round.run.roundIndex ?? 0;
    if (roundIndex < currentRoundIndex) continue;
    const detail = round.run.decisionDetail;
    if (round.run.userDecision === 'reject' && detail?.comment?.trim())
      items.push({
        author: decider(detail.decidedBy),
        createdAt: detail.decidedAt ?? '',
        key: `decision-${round.run.id}`,
        text: detail.comment,
      });
    for (const [index, entry] of (detail?.groupFeedback ?? []).entries()) {
      items.push({
        attachments: entry.attachments,
        author: { kind: 'unknown' },
        createdAt: entry.createdAt,
        key: `group-${round.run.id}-${index}`,
        scope: entry.category || undefined,
        text: entry.comment,
      });
    }
  }

  // Discussion: every comment in a thread nobody has resolved.
  const commentsById = new Map(comments.map((item) => [item.id, item]));
  const checksById = new Map(checks.map((check) => [check.id, check]));
  for (const item of comments) {
    if (item.kind !== 'comment' || item.deletedAt) continue;
    const root = item.parentCommentId ? commentsById.get(item.parentCommentId) : item;
    if (!root || root.resolvedAt) continue;
    const check = root.checkItemId ? checksById.get(root.checkItemId) : undefined;
    const mine =
      Boolean(viewer.id) && item.author.type !== 'agent' && item.authorUserId === viewer.id;
    items.push({
      annotationCount: !item.parentCommentId && root.rect ? 1 : undefined,
      attachments: item.attachments,
      author: {
        avatar: item.author.avatar || undefined,
        kind: mine ? 'mine' : 'other',
        // Same fallback as the discussion's comment cards.
        name: item.author.fullName || item.author.username || '—',
      },
      createdAt: new Date(item.createdAt).toISOString(),
      key: `comment-${item.id}`,
      scope: check ? `C${check.seq} ${check.title}` : undefined,
      text: item.content,
    });
  }

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export type RejectFeedbackPreviewState = 'error' | 'loading' | 'none' | 'ready';

/**
 * Which face the preview shows. "Nothing else goes along" is a claim, so it is
 * only made once the discussion has actually loaded — a still-empty or failed
 * comment list must never read as an empty set, since the agent will fetch it.
 */
export const rejectFeedbackPreviewState = ({
  bundleReady,
  commentsError,
  commentsLoading,
  count,
}: {
  bundleReady: boolean;
  commentsError?: unknown;
  commentsLoading: boolean;
  count: number;
}): RejectFeedbackPreviewState => {
  if (!bundleReady || commentsLoading) return 'loading';
  if (commentsError) return 'error';
  return count > 0 ? 'ready' : 'none';
};
