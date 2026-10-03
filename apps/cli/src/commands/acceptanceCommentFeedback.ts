import type { AcceptanceCommentItem, AcceptanceCommentSource } from '@lobechat/types';

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
        // A reply answers the page its thread was opened on.
        source: root.source ?? undefined,
        threadId: root.id,
        title: check?.title,
      },
    ];
  });
};

/**
 * The product page a remark was made on, as lines a repair agent can act on:
 * where to go, what to point at, and the facts needed to reproduce the page.
 */
export const formatCommentSource = (source: AcceptanceCommentSource): string[] => {
  const lines = [`page: ${source.url}${source.title ? ` (${source.title})` : ''}`];
  if (source.selector) lines.push(`element: ${source.selector}`);
  if (source.elementText) lines.push(`element text: ${source.elementText}`);
  const facts = Object.entries(source.extra ?? {}).map(([key, value]) => `${key}=${value}`);
  if (facts.length) lines.push(`context: ${facts.join(', ')}`);
  if (source.viewport) lines.push(`viewport: ${source.viewport.width}x${source.viewport.height}`);
  if (source.commit) lines.push(`build: ${source.commit}`);
  for (const error of source.consoleErrors ?? []) lines.push(`console error: ${error}`);
  return lines;
};
