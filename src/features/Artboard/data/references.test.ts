import type { ArtboardItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildBoardModel } from '../model';
import { boardReference } from './references';

const board = buildBoardModel(
  {
    acceptanceId: null,
    content: {
      boards: [
        {
          expected: null,
          flowNodeId: null,
          groupId: 'g1',
          id: 'b1',
          pageId: 'p1',
          rect: { h: 400, w: 640, x: 0, y: 0 },
          roundId: null,
          source: { canvasId: 'cvs_1', kind: 'canvas', version: 1 },
          title: '空项目',
          type: 'html',
        },
      ],
      edges: [],
      groups: [],
      pages: [{ id: 'p1', name: 'Page 1', sortOrder: 0 }],
      questions: [],
      rounds: [],
    },
    id: 'art_1',
    phase: 'discuss',
    revision: 1,
  } as unknown as ArtboardItem,
  {},
);

describe('boardReference', () => {
  it('names a board by its title', () => {
    expect(boardReference(board, 'b1', ' 改短 ')).toEqual({
      artboardId: 'art_1',
      itemId: 'b1',
      itemTitle: '空项目',
      text: '改短',
    });
  });

  it('refers to nothing for a board that is gone', () => {
    expect(boardReference(board, 'b9', 'x')).toBeUndefined();
  });
});
