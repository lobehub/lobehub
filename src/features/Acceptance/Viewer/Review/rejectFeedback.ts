import type { AcceptanceAttachment, AcceptanceCommentItem } from '@lobechat/types';

import type { FeedbackListEntry } from './FeedbackDrawer';

/** One piece of feedback the repair agent will read alongside the reject reason. */
export interface RejectFeedbackItem {
  annotationCount?: number;
  attachments?: AcceptanceAttachment[];
  /** Display name for someone else's comment; unset for the viewer's own. */
  authorName?: string;
  checkSeq?: number;
  createdAt: string;
  key: string;
  mine: boolean;
  text: string;
  /** The check title for check-scoped feedback, the group label for group notes. */
  title?: string;
}

interface CollectRejectFeedbackParams {
  checks: { id: string; seq: number; title: string }[];
  comments: AcceptanceCommentItem[];
  /** The decider's own queued feedback — already filtered to the current round. */
  ownEntries: FeedbackListEntry[];
  viewerId?: string;
}

/**
 * What the reject's repair prompt actually hands over. The prompt points the
 * agent at `lh acceptance feedback --actionable`, which prints the standing
 * check rejects and group notes plus every unresolved discussion thread — so
 * the dialog previews the same set instead of leaving the reviewer to guess
 * whether a teammate's comment or screenshot rides along. The comment rule
 * mirrors the CLI's `collectCommentFeedback`.
 */
export const collectRejectFeedback = ({
  checks,
  comments,
  ownEntries,
  viewerId,
}: CollectRejectFeedbackParams): RejectFeedbackItem[] => {
  const checksById = new Map(checks.map((check) => [check.id, check]));
  const commentsById = new Map(comments.map((item) => [item.id, item]));

  const own: RejectFeedbackItem[] = ownEntries.map((entry, index) => ({
    annotationCount: entry.annotationCount,
    attachments: entry.attachments,
    checkSeq: entry.checkSeq,
    createdAt: entry.createdAt,
    key: `own-${index}`,
    mine: true,
    text: entry.comment,
    title: entry.kind === 'check' ? entry.title : entry.groupLabel || undefined,
  }));

  const discussion = comments.flatMap((item): RejectFeedbackItem[] => {
    if (item.kind !== 'comment' || item.deletedAt) return [];
    const root = item.parentCommentId ? commentsById.get(item.parentCommentId) : item;
    if (!root || root.resolvedAt) return [];
    const check = root.checkItemId ? checksById.get(root.checkItemId) : undefined;
    const mine =
      Boolean(viewerId) && item.author.type !== 'agent' && item.authorUserId === viewerId;

    return [
      {
        annotationCount: !item.parentCommentId && root.rect ? 1 : undefined,
        attachments: item.attachments,
        authorName: mine ? undefined : item.author.fullName || item.author.username || undefined,
        checkSeq: check?.seq,
        createdAt: new Date(item.createdAt).toISOString(),
        key: `comment-${item.id}`,
        mine,
        text: item.content,
        title: check?.title,
      },
    ];
  });

  return [...own, ...discussion].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
