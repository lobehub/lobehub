import type { AcceptanceCommentItem } from '@lobechat/types';

import { formatAnnotationRegion } from './verifyHelpers';

interface FeedbackCheck {
  id: string;
  seq: number;
  title: string;
}

/** Discussion lives outside getBundle; its threads are resolved explicitly, not by a new round. */
export const collectCommentFeedback = (
  items: AcceptanceCommentItem[],
  checks: FeedbackCheck[],
  evidenceLabels: Map<string, string>,
) => {
  const commentsById = new Map(items.map((item) => [item.id, item]));
  const checksById = new Map(checks.map((check) => [check.id, check]));

  return items.flatMap((item) => {
    if (item.kind !== 'comment' || item.deletedAt) return [];
    // Replies inherit the thread's evidence anchor and resolution state. A
    // deleted root is retained as a tombstone; its surviving replies still matter.
    const root = item.parentCommentId ? commentsById.get(item.parentCommentId) : item;
    if (!root) return [];
    const check = root.checkItemId ? checksById.get(root.checkItemId) : undefined;
    const annotation =
      root.evidenceId && root.rect
        ? { comment: item.content, evidenceId: root.evidenceId, rect: root.rect }
        : undefined;

    return [
      {
        actionable: !root.resolvedAt,
        annotations: annotation
          ? [{ ...annotation, region: formatAnnotationRegion(annotation, evidenceLabels) }]
          : undefined,
        attachments: item.attachments,
        author: item.author,
        checkId: root.checkItemId ?? undefined,
        checkSeq: check?.seq,
        comment: item.content,
        commentId: item.id,
        createdAt: item.createdAt.toISOString(),
        fileIds: item.attachments.map((attachment) => attachment.id),
        kind: 'comment' as const,
        parentCommentId: item.parentCommentId ?? undefined,
        roundIndex: item.contextRoundIndex ?? root.contextRoundIndex ?? 0,
        threadId: root.id,
        title: check?.title,
      },
    ];
  });
};
