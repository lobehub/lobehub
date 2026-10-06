import type { AcceptanceCommentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { collectRejectFeedback } from './rejectFeedback';

const comment = (overrides: Partial<AcceptanceCommentItem>): AcceptanceCommentItem =>
  ({
    acceptanceId: 'acc-1',
    anchorType: 'acceptance',
    attachments: [],
    author: {
      avatar: null,
      fullName: 'Tsuki',
      id: 'user-2',
      status: 'active',
      type: 'user',
      username: 'tsuki',
    },
    authorAgentId: null,
    authorUserId: 'user-2',
    canDelete: false,
    clientId: 'c',
    content: 'looks off',
    contextRoundIndex: 1,
    createdAt: new Date('2026-10-07T10:00:00Z'),
    deletedAt: null,
    editorData: null,
    id: 'cm-1',
    kind: 'comment',
    parentCommentId: null,
    reactions: [],
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  }) as AcceptanceCommentItem;

describe('collectRejectFeedback', () => {
  const checks = [{ id: 'chk-1', seq: 3, title: 'Dark mode' }];

  it('previews own rejects and teammates’ open comments with their screenshots', () => {
    const items = collectRejectFeedback({
      checks,
      comments: [
        comment({
          attachments: [{ id: 'f-1', name: 'shot.png', url: 'https://x/shot.png' }] as any,
          checkItemId: 'chk-1',
          evidenceId: 'ev-1',
          rect: { height: 0.1, width: 0.1, x: 0, y: 0 },
        }),
      ],
      ownEntries: [
        {
          checkId: 'chk-1',
          checkSeq: 3,
          comment: 'contrast too low',
          createdAt: '2026-10-07T09:00:00.000Z',
          kind: 'check',
          roundIndex: 1,
          stale: false,
          title: 'Dark mode',
        },
      ],
      viewer: { id: 'user-1', name: 'Arvin' },
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      annotationCount: 1,
      authorName: 'Tsuki',
      checkSeq: 3,
      mine: false,
      text: 'looks off',
    });
    expect(items[0].attachments).toHaveLength(1);
    expect(items[1]).toMatchObject({
      authorName: 'Arvin',
      mine: true,
      text: 'contrast too low',
      title: 'Dark mode',
    });
  });

  it('leaves out what the CLI does not hand over: resolved threads, deleted rows, approvals', () => {
    const items = collectRejectFeedback({
      checks,
      comments: [
        comment({ id: 'root', resolvedAt: new Date() }),
        comment({ content: 'reply in a resolved thread', id: 'reply', parentCommentId: 'root' }),
        comment({ deletedAt: new Date(), id: 'gone' }),
        comment({ id: 'ok', kind: 'approval' }),
      ],
      ownEntries: [],
      viewer: { id: 'user-1', name: 'Arvin' },
    });

    expect(items).toEqual([]);
  });

  it('names the viewer’s own discussion comments instead of saying “you”', () => {
    const [item] = collectRejectFeedback({
      checks,
      comments: [
        comment({
          author: {
            avatar: 'https://x/arvin.png',
            fullName: 'Arvin',
            id: 'user-1',
            status: 'active',
            type: 'user',
            username: 'arvin',
          },
          authorUserId: 'user-1',
        }),
      ],
      ownEntries: [],
      viewer: { id: 'user-1', name: 'Arvin' },
    });

    expect(item).toMatchObject({
      authorAvatar: 'https://x/arvin.png',
      authorName: 'Arvin',
      mine: true,
    });
  });
});
