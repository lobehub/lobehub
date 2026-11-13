import type { ArtboardCommentThreadView, ArtboardItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildBoardModel } from '../model';
import { isAnswered, isQuestion, nextQuestion, pagePins, threadPlace } from './commentModel';

const rect = (x: number, y: number, w = 640, h = 400) => ({ h, w, x, y });

const item = {
  content: {
    boards: [
      {
        expected: null,
        flowNodeId: null,
        groupId: 'g1',
        id: 'b1',
        pageId: 'p1',
        rect: rect(100, 200),
        roundId: null,
        source: null,
        title: '首页',
        type: 'html',
      },
    ],
    edges: [],
    groups: [
      {
        desc: '',
        id: 'g1',
        kind: 'journey',
        pageId: 'p1',
        rect: rect(52, 56, 736, 592),
        title: '主流程',
      },
    ],
    pages: [
      { id: 'p1', name: 'Page 1', sortOrder: 0 },
      { id: 'p2', name: 'Page 2', sortOrder: 1 },
    ],
    questions: [],
    rounds: [],
  },
  id: 'art_1',
  phase: 'discuss',
} as unknown as ArtboardItem;

const model = buildBoardModel(item, {});

const thread = (id: string, patch: Partial<ArtboardCommentThreadView> = {}) =>
  ({
    anchor: null,
    authorAgentId: null,
    authorUserId: 'u1',
    boardId: null,
    content: id,
    createdAt: new Date(0),
    groupId: null,
    id,
    pageId: 'p1',
    replies: [],
    resolvedAt: null,
    stale: false,
    unread: false,
    ...patch,
  }) as ArtboardCommentThreadView;

const reply = (authorAgentId: string | null) => ({
  authorAgentId,
  authorUserId: 'u1',
  content: 'r',
  createdAt: new Date(1),
  id: `r-${authorAgentId}`,
});

describe('pagePins', () => {
  it('places a board comment by fractions of the board', () => {
    const [pin] = pagePins(
      [thread('t1', { anchor: { type: 'canvas', x: 0.5, y: 0.25 }, boardId: 'b1' })],
      model,
    );
    expect(pin).toMatchObject({ x: 420, y: 300 });
  });

  it('places a group comment from the group’s top-left and a canvas comment on the page', () => {
    const pins = pagePins(
      [
        thread('t1', { anchor: { type: 'canvas', x: 30, y: 20 }, groupId: 'g1' }),
        thread('t2', { anchor: { type: 'canvas', x: 900, y: -40 } }),
      ],
      model,
    );
    expect(pins.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 82, y: 76 },
      { x: 900, y: -40 },
    ]);
  });

  it('puts an unanchored board thread on the board’s top-right corner', () => {
    const [pin] = pagePins([thread('t1', { boardId: 'b1' })], model);
    expect(pin).toMatchObject({ x: 740, y: 200 });
  });

  it('leaves out threads of other pages', () => {
    expect(pagePins([thread('t1', { pageId: 'p2' })], model)).toEqual([]);
  });
});

describe('threads', () => {
  it('treats an agent-opened thread as a question, answered once a user replies', () => {
    const asked = thread('q1', { authorAgentId: 'agt_1' });
    expect(isQuestion(asked)).toBe(true);
    expect(isQuestion(thread('t1'))).toBe(false);
    expect(isAnswered(asked)).toBe(false);
    expect(isAnswered({ ...asked, replies: [reply('agt_1')] })).toBe(false);
    expect(isAnswered({ ...asked, replies: [reply(null)] })).toBe(true);
  });

  it('cycles through the questions still waiting for an answer', () => {
    const threads = [
      thread('q1', { authorAgentId: 'agt_1' }),
      thread('t1'),
      thread('q2', { authorAgentId: 'agt_1', replies: [reply(null)] }),
      thread('q3', { authorAgentId: 'agt_1', pageId: 'p2' }),
      thread('q4', { authorAgentId: 'agt_1', resolvedAt: new Date(2) }),
    ];
    expect(nextQuestion(threads, null)?.id).toBe('q1');
    expect(nextQuestion(threads, 'q1')?.id).toBe('q3');
    expect(nextQuestion(threads, 'q3')?.id).toBe('q1');
    expect(nextQuestion([thread('t1')], null)).toBeUndefined();
  });

  it('names where a thread sits', () => {
    expect(threadPlace(thread('t1', { boardId: 'b1' }), model)).toEqual({
      kind: 'board',
      title: '首页',
    });
    expect(threadPlace(thread('t1', { groupId: 'g1' }), model)).toEqual({
      kind: 'group',
      title: '主流程',
    });
    expect(threadPlace(thread('t1'), model)).toEqual({ kind: 'canvas' });
  });
});
