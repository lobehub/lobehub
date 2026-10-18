import type { DocumentCommentItem, DocumentCommentThread } from '@lobechat/types';

/**
 * Pure item-level patches of the comment feeds. They run inside replica
 * optimistic overlays and confirms, so each returns the same array when
 * nothing matched — an overlay that changes nothing must not repaint.
 */

const mapChanged = <T>(items: T[], fn: (item: T) => T): T[] => {
  let changed = false;
  const next = items.map((item) => {
    const mapped = fn(item);
    if (mapped !== item) changed = true;
    return mapped;
  });
  return changed ? next : items;
};

/** Append a new root at the end (feeds are oldest-first); a root already there is kept. */
export const appendThread = (
  threads: DocumentCommentThread[],
  comment: DocumentCommentItem,
): DocumentCommentThread[] =>
  threads.some(
    ({ root }) =>
      root.id === comment.id || (comment.clientId && root.clientId === comment.clientId),
  )
    ? threads
    : [...threads, { replyCount: 0, root: comment }];

/** Swap the root matching `comment` by id. */
export const replaceThreadRoot = (threads: DocumentCommentThread[], comment: DocumentCommentItem) =>
  mapChanged(threads, (thread) =>
    thread.root.id === comment.id ? { ...thread, root: comment } : thread,
  );

export const updateThreadReplyCount = (
  threads: DocumentCommentThread[],
  rootCommentId: string,
  delta: number,
) =>
  mapChanged(threads, (thread) =>
    thread.root.id === rootCommentId
      ? { ...thread, replyCount: Math.max(0, thread.replyCount + delta) }
      : thread,
  );

/** Append a new reply at the end; a reply already there (same id or client id) is kept. */
export const appendReply = (replies: DocumentCommentItem[], comment: DocumentCommentItem) =>
  replies.some(
    (item) => item.id === comment.id || (comment.clientId && item.clientId === comment.clientId),
  )
    ? replies
    : [...replies, comment];

/** Swap the reply matching `comment` by id. */
export const replaceReply = (replies: DocumentCommentItem[], comment: DocumentCommentItem) =>
  mapChanged(replies, (item) => (item.id === comment.id ? comment : item));
