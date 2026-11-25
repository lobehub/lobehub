import type { ArtboardItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildBoardModel } from '../model';
import { commentTargetAt } from './commentActions';

const rect = (x: number, y: number, w = 640, h = 400) => ({ h, w, x, y });

const model = buildBoardModel(
  {
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
      pages: [{ id: 'p1', name: 'Page 1', sortOrder: 0 }],
      questions: [],
      rounds: [],
    },
    id: 'art_1',
    phase: 'discuss',
  } as unknown as ArtboardItem,
  {},
);

describe('commentTargetAt', () => {
  it('anchors a click on a board by fractions of the board', () => {
    expect(commentTargetAt(model, { x: 420, y: 300 })).toEqual({
      anchor: { type: 'canvas', x: 0.5, y: 0.25 },
      boardId: 'b1',
      pageId: 'p1',
    });
  });

  it('anchors a click inside a group frame from the group’s top-left', () => {
    expect(commentTargetAt(model, { x: 82, y: 76 })).toEqual({
      anchor: { type: 'canvas', x: 30, y: 20 },
      groupId: 'g1',
      pageId: 'p1',
    });
  });

  it('anchors a click on empty canvas in page coordinates', () => {
    expect(commentTargetAt(model, { x: 2000, y: -40 })).toEqual({
      anchor: { type: 'canvas', x: 2000, y: -40 },
      pageId: 'p1',
    });
  });
});
