import type { AcceptanceCommentItem, AcceptanceCommentThread } from '@lobechat/types';

/**
 * The discussion is a conversation, not a filing cabinet: it carries messages
 * about the delivery as a whole, strung together with the events that happened
 * between them (a round landing, a reviewer approving, a check sent back).
 *
 * A note circled on a screenshot is still a turn in that conversation — the way
 * a review comment on a diff line shows up in a pull request's Conversation
 * tab. It keeps its own shape (`region`) so it renders with the picture and the
 * check it points at, and stays one thread instead of being flattened.
 */
export type DiscussionEntry =
  | { at: Date; comment: AcceptanceCommentItem; kind: 'message' }
  | { at: Date; kind: 'region'; thread: AcceptanceCommentThread }
  | {
      annotationCount: number;
      at: Date;
      checkItemId: string;
      comment?: string;
      kind: 'checkReject';
      roundIndex: number;
    }
  | { at: Date; comment?: string; kind: 'roundReject'; roundIndex: number }
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

/** Threads circled on evidence: shown on their check, and as a region entry here. */
export const regionThreads = (threads: AcceptanceCommentThread[]) =>
  threads.filter((thread) => thread.root.anchorType === 'evidence');

interface ReviewInput {
  action: 'accept' | 'ignore' | 'reject';
  annotations?: unknown[];
  comment?: string;
  createdAt: string;
  roundIndex: number;
}

interface RoundInput {
  createdAt: Date | string | null;
  /** The round's own verdict — only its `comment` is read. */
  decisionDetail?: { comment?: string; decidedAt?: string } | null;
  id?: string;
  roundIndex: number | null;
  userDecision?: string | null;
}

interface BuildInput {
  approvals: AcceptanceCommentItem[];
  /** Union checks — their reject trail is the reviewer's side of the story. */
  checks?: { id: string; reviews: ReviewInput[] }[];
  /** Every comment of the acceptance — proposals are read straight off it. */
  items?: AcceptanceCommentItem[];
  rounds: RoundInput[];
  threads: AcceptanceCommentThread[];
}

/**
 * One chronological stream, oldest first — the order the delivery actually
 * happened in, which is what makes "he asked, then round 4 landed, then she
 * approved" readable at all.
 */
export const buildDiscussionTimeline = ({
  approvals,
  checks = [],
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

  // A region note leads with its root: that is when it was said, and its
  // replies stay under it because they are about the same spot.
  // A withdrawn note with nobody answering it has nothing left to show.
  for (const thread of regionThreads(threads)) {
    if (thread.root.deletedAt && thread.replies.every((reply) => reply.deletedAt)) continue;
    entries.push({ at: new Date(thread.root.createdAt), kind: 'region', thread });
  }

  // Sending a check back is the reviewer's loudest turn, and it lives on the
  // check's result row rather than in the comment table — without it the
  // discussion of a rejected delivery reads as if nobody had said anything.
  for (const check of checks)
    for (const review of check.reviews) {
      if (review.action !== 'reject' || !review.createdAt) continue;
      entries.push({
        annotationCount: review.annotations?.length ?? 0,
        at: new Date(review.createdAt),
        checkItemId: check.id,
        comment: review.comment?.trim() || undefined,
        kind: 'checkReject',
        roundIndex: review.roundIndex,
      });
    }

  for (const round of rounds) {
    if (round.roundIndex === null || !round.createdAt) continue;
    if (round.userDecision === 'reject')
      entries.push({
        at: new Date(round.decisionDetail?.decidedAt ?? round.createdAt),
        comment: round.decisionDetail?.comment?.trim() || undefined,
        kind: 'roundReject',
        roundIndex: round.roundIndex,
      });
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

/**
 * The discussion badge counts contributions: every surviving remark (a region
 * note and each of its replies included), the round's own note, and each
 * send-back that says why.
 */
export const countDiscussionMessages = (input: BuildInput): number =>
  buildDiscussionTimeline(input).reduce((total, entry) => {
    switch (entry.kind) {
      case 'message': {
        return total + (entry.comment.deletedAt ? 0 : 1);
      }
      case 'region': {
        const { replies, root } = entry.thread;
        return total + [root, ...replies].filter((comment) => !comment.deletedAt).length;
      }
      case 'round': {
        return total + (entry.proposal?.content.trim() ? 1 : 0);
      }
      case 'checkReject': {
        return total + (entry.comment || entry.annotationCount > 0 ? 1 : 0);
      }
      case 'roundReject': {
        return total + (entry.comment ? 1 : 0);
      }
      default: {
        return total;
      }
    }
  }, 0);
