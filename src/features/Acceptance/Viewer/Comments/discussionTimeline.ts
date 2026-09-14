import type { AcceptanceCommentItem, AcceptanceCommentThread } from '@lobechat/types';

/**
 * The discussion is a conversation, not a filing cabinet: it carries messages
 * about the delivery as a whole, strung together with the events that happened
 * between them (a round landing, a reviewer approving).
 *
 * Comments circled on a screenshot are deliberately NOT here — a region note
 * only means anything next to the pixels it points at, so it lives on the check
 * that owns that evidence.
 */
export type DiscussionEntry =
  | { at: Date; comment: AcceptanceCommentItem; kind: 'message' }
  | {
      at: Date;
      kind: 'round';
      /** The round's own note, signed by the agent that produced it. */
      proposal?: AcceptanceCommentItem;
      roundIndex: number;
      runId?: string;
    }
  | { approval: AcceptanceCommentItem; at: Date; kind: 'approval' };

/**
 * Threads that belong in the discussion stream: plain, delivery-wide remarks.
 * A proposal is not one of them — it is the round's own note and renders as
 * part of that round, so listing it here too would say the same thing twice.
 */
export const messageThreads = (threads: AcceptanceCommentThread[]) =>
  threads.filter(
    (thread) => thread.root.anchorType === 'acceptance' && thread.root.kind !== 'proposal',
  );

/** Threads circled on evidence, which belong on the check rows instead. */
export const regionThreads = (threads: AcceptanceCommentThread[]) =>
  threads.filter((thread) => thread.root.anchorType === 'evidence');

interface BuildInput {
  approvals: AcceptanceCommentItem[];
  /** Every comment of the acceptance — proposals are read straight off it. */
  items?: AcceptanceCommentItem[];
  rounds: { createdAt: Date | string | null; id?: string; roundIndex: number | null }[];
  threads: AcceptanceCommentThread[];
}

/**
 * One chronological stream, oldest first — the order the delivery actually
 * happened in, which is what makes "he asked, then round 4 landed, then she
 * approved" readable at all.
 */
export const buildDiscussionTimeline = ({
  approvals,
  items = [],
  rounds,
  threads,
}: BuildInput): DiscussionEntry[] => {
  const entries: DiscussionEntry[] = [];

  // One note per round; a later one wins, which is what a re-ingest of the
  // same round means.
  const proposalByRun = new Map<string, AcceptanceCommentItem>();
  for (const item of items) {
    if (item.kind !== 'proposal' || !item.contextRunId || item.deletedAt) continue;
    proposalByRun.set(item.contextRunId, item);
  }

  // Flattened: the discussion is a chat, so a reply to a delivery-wide remark
  // is just the next message. Threading is for regions, where a note and its
  // answers are about one spot on one picture.
  for (const thread of messageThreads(threads))
    for (const comment of [thread.root, ...thread.replies])
      entries.push({ at: new Date(comment.createdAt), comment, kind: 'message' });

  for (const round of rounds) {
    if (round.roundIndex === null || !round.createdAt) continue;
    entries.push({
      at: new Date(round.createdAt),
      kind: 'round',
      proposal: round.id ? proposalByRun.get(round.id) : undefined,
      roundIndex: round.roundIndex,
      runId: round.id,
    });
  }

  for (const approval of approvals) {
    if (approval.deletedAt) continue;
    entries.push({ approval, at: new Date(approval.createdAt), kind: 'approval' });
  }

  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
};
