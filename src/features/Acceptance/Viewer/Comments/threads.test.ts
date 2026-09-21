import type { AcceptanceCommentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  groupCommentThreads,
  listParticipants,
  summarizeApprovals,
  threadsForCheck,
  threadsForEvidence,
} from './threads';

const author = (id: string): AcceptanceCommentItem['author'] => ({
  avatar: null,
  fullName: id,
  id,
  status: 'active',
  type: 'user',
  username: id,
});

let seq = 0;
const item = (overrides: Partial<AcceptanceCommentItem> = {}): AcceptanceCommentItem => {
  seq += 1;
  const authorId = overrides.authorUserId ?? 'u1';
  return {
    acceptanceId: 'acc',
    anchorType: 'acceptance',
    attachments: [],
    author: author(authorId),
    authorAgentId: null,
    authorUserId: authorId,
    canDelete: false,
    checkItemId: null,
    clientId: `c${seq}`,
    content: `content ${seq}`,
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

describe('groupCommentThreads', () => {
  it('nests replies under their root and keeps approvals out of the discussion', () => {
    const root = item();
    const reply = item({ parentCommentId: root.id });
    const approval = item({ kind: 'approval' });
    const orphan = item({ parentCommentId: 'missing' });

    const threads = groupCommentThreads([root, reply, approval, orphan]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe(root.id);
    expect(threads[0].replies.map((r) => r.id)).toEqual([reply.id]);
  });

  it('filters threads by evidence and by check', () => {
    const onImage = item({ anchorType: 'evidence', checkItemId: 'c2', evidenceId: 'ev1' });
    const onOther = item({ anchorType: 'evidence', checkItemId: 'c2', evidenceId: 'ev2' });
    const global = item();
    const threads = groupCommentThreads([onImage, onOther, global]);

    expect(threadsForEvidence(threads, 'ev1').map((t) => t.root.id)).toEqual([onImage.id]);
    expect(threadsForCheck(threads, 'c2').map((t) => t.root.id)).toEqual([onImage.id, onOther.id]);
  });
});

describe('summarizeApprovals', () => {
  it('keeps one entry per reviewer at their newest approval', () => {
    const early = item({ authorUserId: 'wenyi', contextRoundIndex: 2, kind: 'approval' });
    const late = item({ authorUserId: 'wenyi', contextRoundIndex: 4, kind: 'approval' });
    const other = item({ authorUserId: 'liansheng', contextRoundIndex: 4, kind: 'approval' });
    const deleted = item({
      authorUserId: 'gone',
      deletedAt: new Date(),
      kind: 'approval',
    });

    const summary = summarizeApprovals([early, late, other, deleted, item()]);
    expect(summary.map((s) => [s.authorUserId, s.contextRoundIndex])).toEqual([
      ['wenyi', 4],
      ['liansheng', 4],
    ]);
  });
});

describe('listParticipants', () => {
  it('lists each live author once in first-seen order', () => {
    const rows = [
      item({ authorUserId: 'b' }),
      item({ authorUserId: 'a' }),
      item({ authorUserId: 'b', kind: 'approval' }),
      item({ authorUserId: 'c', deletedAt: new Date() }),
    ];
    expect(listParticipants(rows).map((p) => p.userId)).toEqual(['b', 'a']);
  });
});
