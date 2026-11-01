import type {
  AcceptanceApprovalSummary,
  AcceptanceCommentItem,
  AcceptanceCommentList,
  AcceptanceCommentThread,
} from '@lobechat/types';

/**
 * Group a flat, oldest-first comment list into threads. A reply whose root is
 * missing (never expected — the server keeps threads inside one acceptance) is
 * dropped rather than rendered orphaned. Approvals are not discussion and are
 * left out; read them with {@link summarizeApprovals}.
 */
export const groupCommentThreads = (items: AcceptanceCommentItem[]): AcceptanceCommentThread[] => {
  const threads = new Map<string, AcceptanceCommentThread>();
  for (const item of items) {
    if (item.parentCommentId) continue;
    if (item.kind === 'approval') continue;
    threads.set(item.id, { replies: [], root: item });
  }
  for (const item of items) {
    if (!item.parentCommentId) continue;
    threads.get(item.parentCommentId)?.replies.push(item);
  }
  return [...threads.values()];
};

/** Threads circled on one evidence image, in posting order. */
export const threadsForEvidence = (threads: AcceptanceCommentThread[], evidenceId: string) =>
  threads.filter((thread) => thread.root.evidenceId === evidenceId);

/** Threads hanging on one union check (any of its evidence images). */
export const threadsForCheck = (threads: AcceptanceCommentThread[], checkItemId: string) =>
  threads.filter((thread) => thread.root.checkItemId === checkItemId);

/**
 * Each reviewer's standing opinion: their NEWEST approval row. Someone who
 * approved round 2 and again round 4 shows once, at round 4.
 */
export const summarizeApprovals = (items: AcceptanceCommentItem[]): AcceptanceApprovalSummary[] => {
  const latest = new Map<string, AcceptanceApprovalSummary>();
  for (const item of items) {
    if (item.kind !== 'approval' || !item.authorUserId || item.deletedAt) continue;
    latest.set(item.authorUserId, {
      author: item.author,
      authorUserId: item.authorUserId,
      contextRoundIndex: item.contextRoundIndex,
      createdAt: item.createdAt,
    });
  }
  return [...latest.values()];
};

/** Live participants: everyone who wrote a surviving row, in first-seen order. */
export const listParticipants = (items: AcceptanceCommentItem[]) => {
  const seen = new Map<string, AcceptanceCommentItem['author']>();
  for (const item of items) {
    if (!item.authorUserId || item.deletedAt || seen.has(item.authorUserId)) continue;
    seen.set(item.authorUserId, item.author);
  }
  return [...seen.entries()].map(([userId, author]) => ({ author, userId }));
};

/**
 * The list as it will look once the server has taken the click, so the chip can
 * fill in immediately. `mine` is the only thing the caller knows for certain,
 * which is why the count moves by exactly one and the name list is left alone —
 * a wrong name for 300ms is worse than a late one.
 */
export const toggleReaction = (
  list: AcceptanceCommentList,
  commentId: string,
  emoji: string,
  on: boolean,
): AcceptanceCommentList => ({
  ...list,
  items: list.items.map((item) => {
    if (item.id !== commentId) return item;
    const existing = item.reactions.find((reaction) => reaction.emoji === emoji);
    if (on) {
      if (existing?.mine) return item;
      return {
        ...item,
        reactions: existing
          ? item.reactions.map((reaction) =>
              reaction.emoji === emoji
                ? { ...reaction, count: reaction.count + 1, mine: true }
                : reaction,
            )
          : [...item.reactions, { authorNames: [], count: 1, emoji, mine: true }],
      };
    }
    if (!existing?.mine) return item;
    return {
      ...item,
      reactions: item.reactions.flatMap((reaction) =>
        reaction.emoji === emoji
          ? reaction.count <= 1
            ? []
            : [{ ...reaction, count: reaction.count - 1, mine: false }]
          : [reaction],
      ),
    };
  }),
});
