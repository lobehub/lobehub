import type { AcceptanceCommentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { collectRejectFeedback, rejectFeedbackPreviewState } from './rejectFeedback';

const tsuki = {
  avatar: 'https://x/tsuki.png',
  fullName: 'Tsuki',
  id: 'user-2',
  status: 'active' as const,
  type: 'user' as const,
  username: 'tsuki',
};

const comment = (overrides: Partial<AcceptanceCommentItem>): AcceptanceCommentItem =>
  ({
    acceptanceId: 'acc-1',
    anchorType: 'acceptance',
    attachments: [],
    author: tsuki,
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

const reject = (id: string, overrides: Record<string, unknown> = {}) => ({
  action: 'reject',
  comment: `reject ${id}`,
  createdAt: '2026-10-07T09:00:00.000Z',
  id,
  roundIndex: 1,
  ...overrides,
});

const check = (id: string, seq: number, reviews: any[], userReview?: Record<string, unknown>) => ({
  id,
  reviews,
  seq,
  title: `Check ${seq}`,
  userReview: userReview ?? (reviews.length ? { ...reviews.at(-1), stale: false } : undefined),
});

const bundle = (overrides: Record<string, unknown> = {}): any => ({
  acceptance: { userId: 'user-1' },
  author: { avatar: null, fullName: 'Arvin', id: 'user-1', username: 'arvin' },
  checks: [],
  flows: [],
  rounds: [{ run: { id: 'run-1', roundIndex: 1 } }],
  ...overrides,
});

const viewer = { avatar: 'https://x/arvin.png', id: 'user-1', name: 'Arvin' };

describe('collectRejectFeedback', () => {
  it('credits a check reject to whoever decided it, not to the reader', () => {
    const items = collectRejectFeedback({
      bundle: bundle({
        checks: [
          check('c1', 1, [reject('r1', { decidedBy: 'user-2' })]),
          check('c2', 2, [reject('r2', { decidedBy: 'user-1' })]),
          // Legacy row without decidedBy: only the owner could write it.
          check('c3', 3, [reject('r3')]),
        ],
      }),
      // Tsuki's profile is known from the discussion.
      comments: [comment({ id: 'cm-1', resolvedAt: new Date() })],
      viewer,
    });

    const byText = Object.fromEntries(items.map((item) => [item.text, item.author]));
    expect(byText['reject r1']).toMatchObject({ kind: 'other', name: 'Tsuki' });
    expect(byText['reject r2']).toMatchObject({ kind: 'mine', name: 'Arvin' });
    expect(byText['reject r3']).toMatchObject({ kind: 'mine' });
  });

  it('names a teammate it has no profile for as unknown-named, never as the reader', () => {
    const [item] = collectRejectFeedback({
      bundle: bundle({ checks: [check('c1', 1, [reject('r1', { decidedBy: 'user-9' })])] }),
      comments: [],
      viewer,
    });

    expect(item.author).toEqual({ avatar: undefined, kind: 'other', name: undefined });
  });

  it('marks group notes unattributed — they record no author', () => {
    const [item] = collectRejectFeedback({
      bundle: bundle({
        rounds: [
          {
            run: {
              decisionDetail: {
                groupFeedback: [
                  { category: 'Layout', comment: 'spacing', createdAt: '2026-10-07T09:00:00Z' },
                ],
              },
              id: 'run-1',
              roundIndex: 1,
            },
          },
        ],
      }),
      comments: [],
      viewer,
    });

    expect(item).toMatchObject({ author: { kind: 'unknown' }, scope: 'Layout', text: 'spacing' });
  });

  it('keeps only standing check rejects, as the CLI does', () => {
    const items = collectRejectFeedback({
      bundle: bundle({
        checks: [
          // Rejected, then accepted: the reject no longer stands.
          check('c1', 1, [reject('r1'), { ...reject('r1b'), action: 'accept' }]),
          // Consumed by a later round.
          check('c2', 2, [reject('r2')], { action: 'reject', stale: true }),
        ],
      }),
      comments: [],
      viewer,
    });

    expect(items).toEqual([]);
  });

  it('includes the latest rejected attempt of the newest flow run, with its screenshots', () => {
    const attempt = (id: string, review: string | null, overrides = {}) => ({
      checkItemId: 'item-1',
      checkResultId: `res-${id}`,
      id,
      nodeId: 'node-1',
      review,
      reviewAttachments: [{ id: 'f-1', name: 'shot.png', url: 'https://x/shot.png' }],
      reviewComment: `attempt ${id}`,
      reviewDetail: { decidedAt: '2026-10-07T09:00:00Z', decidedBy: 'user-1' },
      sequence: 1,
      ...overrides,
    });
    const items = collectRejectFeedback({
      bundle: bundle({
        // The flow's result rows also appear as check reviews; they must not double up.
        checks: [check('c1', 1, [reject('res-a2')])],
        flows: [
          {
            versions: [
              {
                id: 'v2',
                nodes: [{ id: 'node-1', title: 'Checkout' }],
                runs: [
                  {
                    attempts: [
                      attempt('a1', 'rejected'),
                      attempt('a2', 'rejected', { sequence: 2 }),
                      attempt('other', 'rejected', { checkItemId: 'item-2', sequence: 3 }),
                    ],
                    id: 'run-new',
                  },
                  { attempts: [attempt('old', 'rejected')], id: 'run-old' },
                ],
              },
            ],
          },
        ],
      }),
      comments: [],
      viewer,
    });

    expect(items.map((item) => item.text).sort()).toEqual(['attempt a2', 'attempt other']);
    const a2 = items.find((item) => item.text === 'attempt a2')!;
    expect(a2).toMatchObject({ author: { kind: 'mine' }, scope: 'Checkout · #2' });
    expect(a2.attachments).toHaveLength(1);
  });

  it('previews teammates’ open comments with screenshots and leaves out what the CLI drops', () => {
    const items = collectRejectFeedback({
      bundle: bundle({ checks: [check('chk-1', 3, [])] }),
      comments: [
        comment({
          attachments: [{ id: 'f-1', name: 'shot.png', url: 'https://x/shot.png' }] as any,
          checkItemId: 'chk-1',
          evidenceId: 'ev-1',
          rect: { height: 0.1, width: 0.1, x: 0, y: 0 },
        }),
        comment({ id: 'root', resolvedAt: new Date() }),
        comment({ content: 'reply in a resolved thread', id: 'reply', parentCommentId: 'root' }),
        comment({ deletedAt: new Date(), id: 'gone' }),
        comment({ id: 'ok', kind: 'approval' }),
      ],
      viewer,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      annotationCount: 1,
      author: { avatar: 'https://x/tsuki.png', kind: 'other', name: 'Tsuki' },
      scope: 'C3 Check 3',
      text: 'looks off',
    });
    expect(items[0].attachments).toHaveLength(1);
  });
});

describe('rejectFeedbackPreviewState', () => {
  // Regression: the dialog snapshotted the still-empty comment list and told the
  // reviewer nothing else goes along while the agent would read every comment.
  it('never claims an empty set while comments are loading or failed', () => {
    const base = { bundleReady: true, commentsLoading: false, count: 0 };
    expect(rejectFeedbackPreviewState({ ...base, commentsLoading: true })).toBe('loading');
    expect(rejectFeedbackPreviewState({ ...base, bundleReady: false })).toBe('loading');
    expect(rejectFeedbackPreviewState({ ...base, commentsError: new Error('boom') })).toBe('error');
    expect(
      rejectFeedbackPreviewState({ ...base, commentsError: new Error('boom'), count: 2 }),
    ).toBe('error');
  });

  it('reports none only once the discussion has loaded', () => {
    const base = { bundleReady: true, commentsLoading: false };
    expect(rejectFeedbackPreviewState({ ...base, count: 0 })).toBe('none');
    expect(rejectFeedbackPreviewState({ ...base, count: 3 })).toBe('ready');
  });
});
