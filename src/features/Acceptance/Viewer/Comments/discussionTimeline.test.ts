import type { AcceptanceCommentItem, AcceptanceCommentThread } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildDiscussionTimeline, messageThreads, regionThreads } from './discussionTimeline';

let seq = 0;
const item = (overrides: Partial<AcceptanceCommentItem> = {}): AcceptanceCommentItem => {
  seq += 1;
  return {
    acceptanceId: 'acc',
    anchorType: 'acceptance',
    attachments: [],
    author: {
      avatar: null,
      fullName: 'u',
      id: 'u1',
      status: 'active',
      type: 'user',
      username: 'u',
    },
    authorAgentId: null,
    authorUserId: 'u1',
    canDelete: false,
    checkItemId: null,
    clientId: `c${seq}`,
    content: `m${seq}`,
    contextRoundIndex: null,
    contextRunId: null,
    createdAt: new Date(2026, 8, 9, 10, seq),
    deletedAt: null,
    editorData: null,
    evidenceId: null,
    id: `id${seq}`,
    kind: 'comment',
    parentCommentId: null,
    reactions: [],
    rect: null,
    resolvedAt: null,
    resolvedByUserId: null,
    updatedAt: new Date(2026, 8, 9, 10, seq),
    ...overrides,
  };
};
const thread = (
  root: AcceptanceCommentItem,
  replies: AcceptanceCommentItem[] = [],
): AcceptanceCommentThread => ({ replies, root });

describe('round notes', () => {
  it("folds a round's proposal into that round's entry instead of listing it", () => {
    const proposal = item({
      contextRunId: 'run-1',
      id: 'proposal-1',
      kind: 'proposal',
    });
    const remark = item({ id: 'remark-1' });

    const entries = buildDiscussionTimeline({
      approvals: [],
      items: [proposal, remark],
      rounds: [{ createdAt: new Date(2026, 8, 9, 9), id: 'run-1', roundIndex: 1 }],
      threads: [
        { replies: [], root: proposal },
        { replies: [], root: remark },
      ],
    });

    const round = entries.find((entry) => entry.kind === 'round');
    expect(round?.kind === 'round' && round.proposal?.id).toBe('proposal-1');
    // The note is the round's, so it never doubles as a message of its own.
    expect(
      entries.filter((entry) => entry.kind === 'message').map((entry) => entry.comment.id),
    ).toEqual(['remark-1']);
  });

  it('leaves a round with no note as a plain event', () => {
    const entries = buildDiscussionTimeline({
      approvals: [],
      items: [],
      rounds: [{ createdAt: new Date(2026, 8, 9, 9), id: 'run-1', roundIndex: 1 }],
      threads: [],
    });
    const round = entries.find((entry) => entry.kind === 'round');
    expect(round?.kind === 'round' && round.proposal).toBeUndefined();
  });
});

describe('discussion split', () => {
  it('keeps delivery-wide remarks and leaves circled regions to the checks', () => {
    const message = thread(item());
    const region = thread(item({ anchorType: 'evidence', checkItemId: 'c2', evidenceId: 'ev1' }));

    expect(messageThreads([message, region])).toEqual([message]);
    expect(regionThreads([message, region])).toEqual([region]);
  });
});

describe('buildDiscussionTimeline', () => {
  it('interleaves messages, rounds and approvals oldest first', () => {
    const early = thread(item({ createdAt: new Date(2026, 8, 9, 10, 0) }));
    const late = thread(item({ createdAt: new Date(2026, 8, 9, 12, 0) }));
    const approval = item({
      createdAt: new Date(2026, 8, 9, 11, 30),
      kind: 'approval',
    });

    const timeline = buildDiscussionTimeline({
      approvals: [approval],
      rounds: [
        { createdAt: new Date(2026, 8, 9, 11, 0), roundIndex: 2 },
        { createdAt: new Date(2026, 8, 9, 9, 0), roundIndex: 1 },
      ],
      threads: [late, early],
    });

    expect(timeline.map((entry) => entry.kind)).toEqual([
      'round',
      'message',
      'round',
      'approval',
      'message',
    ]);
  });

  it('flattens replies to a delivery-wide remark into their own messages', () => {
    const root = item({ createdAt: new Date(2026, 8, 9, 10, 0) });
    const reply = item({
      createdAt: new Date(2026, 8, 9, 10, 30),
      parentCommentId: root.id,
    });

    const timeline = buildDiscussionTimeline({
      approvals: [],
      rounds: [],
      threads: [thread(root, [reply])],
    });

    expect(timeline).toHaveLength(2);
    expect(timeline.map((entry) => (entry.kind === 'message' ? entry.comment.id : ''))).toEqual([
      root.id,
      reply.id,
    ]);
  });

  it('leaves the answers to a circled region out of the chat', () => {
    const root = item({ anchorType: 'evidence', evidenceId: 'ev1' });
    const reply = item({ parentCommentId: root.id });
    const timeline = buildDiscussionTimeline({
      approvals: [],
      rounds: [],
      threads: [thread(root, [reply])],
    });
    expect(timeline).toEqual([]);
  });

  it('drops rounds with no index and withdrawn approvals', () => {
    const timeline = buildDiscussionTimeline({
      approvals: [item({ deletedAt: new Date(), kind: 'approval' })],
      rounds: [
        { createdAt: new Date(2026, 8, 9, 9, 0), roundIndex: null },
        { createdAt: null, roundIndex: 3 },
      ],
      threads: [],
    });

    expect(timeline).toEqual([]);
  });

  it('never lists a circled region as a message', () => {
    const region = thread(item({ anchorType: 'evidence', evidenceId: 'ev1' }));
    const timeline = buildDiscussionTimeline({ approvals: [], rounds: [], threads: [region] });
    expect(timeline).toEqual([]);
  });
});
