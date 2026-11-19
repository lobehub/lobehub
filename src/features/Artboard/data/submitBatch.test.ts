import type { ArtboardCommentThreadView, ArtboardRoundView } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardModel } from '../model';
import { pendingThreads, submitBoardBatch, summarizeRounds } from './submitBatch';

const mocks = vi.hoisted(() => ({
  deliverComments: vi.fn(),
  send: vi.fn(),
  submitRounds: vi.fn(),
}));
vi.mock('@/services/artboard', () => ({
  artboardService: { deliverComments: mocks.deliverComments, submitRounds: mocks.submitRounds },
}));
vi.mock('./boardConversation', () => ({ sendToBoardConversation: mocks.send }));
vi.mock('./useArtboard', () => ({ mutateArtboard: vi.fn() }));
vi.mock('./useArtboardComments', () => ({ mutateArtboardComments: vi.fn() }));
vi.mock('i18next', () => ({
  t: (key: string, options?: Record<string, unknown>) =>
    key === 'artboard.chat.quote' ? `Re: ${options?.target}` : `${key}:${options?.count}`,
}));

const model = {
  artboard: { id: 'art_1', title: '画板', topicId: 'tpc_1' },
  boardById: {
    b1: { id: 'b1', roundId: null, title: '购物清单' },
    b2: { id: 'b2', roundId: 'r1', title: '方案 A' },
  },
  groups: [{ id: 'g1', title: '主流程' }],
  openRounds: [],
} as unknown as BoardModel;

const comment = (content: string, agent = false) => ({
  authorAgentId: agent ? 'agt_1' : null,
  authorUserId: agent ? null : 'u1',
  content,
  createdAt: new Date(),
  id: `c_${content}`,
});

const thread = (
  id: string,
  root: ReturnType<typeof comment>,
  replies: ReturnType<typeof comment>[] = [],
  extra: Partial<ArtboardCommentThreadView> = {},
) =>
  ({
    ...root,
    anchor: null,
    boardId: 'b1',
    groupId: null,
    id,
    pageId: 'p1',
    replies,
    resolvedAt: null,
    stale: false,
    unread: true,
    ...extra,
  }) as ArtboardCommentThreadView;

const round = (id: string, patch: Partial<ArtboardRoundView> = {}): ArtboardRoundView => ({
  batchId: null,
  chosenBoardId: null,
  id,
  pageId: 'p1',
  recommendedBoardId: null,
  status: 'open',
  title: id,
  ...patch,
});

describe('summarizeRounds', () => {
  it('counts picks, recommendations that will apply, and rounds with neither', () => {
    expect(
      summarizeRounds([
        round('r1', { chosenBoardId: 'a', recommendedBoardId: 'b' }),
        round('r2', { recommendedBoardId: 'c' }),
        round('r3'),
        round('r4'),
      ]),
    ).toEqual({ byRecommendation: 1, firstUndecidedId: 'r3', picked: 1, total: 4, undecided: 2 });
  });
});

describe('pendingThreads', () => {
  it('counts every unread thread the next submit sends, including those on open-round options', () => {
    const threads = [
      thread('t1', comment('一')),
      thread('t2', comment('二'), [], { boardId: 'b2' }),
      thread('t3', comment('三'), [], { unread: false }),
      thread('t4', comment('四'), [], { resolvedAt: new Date() }),
      thread('t5', comment('放哪？', true), [comment('标题旁')], { resolvedAt: new Date() }),
    ];

    expect(pendingThreads(threads).map((item) => item.id)).toEqual(['t1', 't2', 't5']);
  });
});

describe('submitBoardBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitRounds.mockResolvedValue({ submitted: 1 });
    mocks.send.mockResolvedValue('sent');
  });

  it('sends the picks and the new comments to the topic as one message', async () => {
    mocks.deliverComments.mockResolvedValue([
      thread('t1', comment('这里改下 ui')),
      thread('t2', comment('要不要加按钮', true), [comment('要')], {
        boardId: null,
        groupId: 'g1',
      }),
      thread('t3', comment('旧的'), [], { unread: false }),
    ]);

    const result = await submitBoardBatch(model, ['r1']);

    expect(mocks.submitRounds).toHaveBeenCalledWith('art_1', ['r1']);
    expect(result.status).toBe('sent');
    expect(mocks.send).toHaveBeenCalledWith(
      'tpc_1',
      [
        'artboard.submit.message:1',
        'artboard.submit.commentMessage:2',
        '> Re: t1 · 购物清单 · artboard art_1\n\n这里改下 ui',
        '> Re: t2 · 主流程 · artboard art_1\n\n要',
        '> artboard art_1 · 画板',
      ].join('\n\n'),
    );
  });

  it('sends comments alone when there is no open round', async () => {
    mocks.deliverComments.mockResolvedValue([thread('t1', comment('太挤了'))]);

    await submitBoardBatch(model, []);

    expect(mocks.submitRounds).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][1]).toMatch(/^artboard\.submit\.commentMessage:1\n\n> Re: t1/);
  });

  it('still submits when the board has no conversation', async () => {
    mocks.deliverComments.mockResolvedValue([]);
    mocks.send.mockResolvedValue('noConversation');

    expect((await submitBoardBatch(model, ['r1'])).status).toBe('noConversation');
  });

  it('reports a message that failed after the batch was saved', async () => {
    mocks.deliverComments.mockResolvedValue([]);
    mocks.send.mockRejectedValue(new Error('offline'));

    expect((await submitBoardBatch(model, ['r1'])).status).toBe('messageFailed');
  });

  it('sends nothing when the round submit is refused', async () => {
    mocks.submitRounds.mockRejectedValueOnce(new Error('missing choice'));

    await expect(submitBoardBatch(model, ['r1'])).rejects.toThrow('missing choice');
    expect(mocks.deliverComments).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('sends nothing when there is nothing new', async () => {
    mocks.deliverComments.mockResolvedValue([thread('t3', comment('旧的'), [], { unread: false })]);

    expect((await submitBoardBatch(model, [])).status).toBe('nothing');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
