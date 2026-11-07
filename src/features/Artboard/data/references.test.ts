import type { ArtboardItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildBoardModel } from '../model';
import { boardReference } from './references';

const board = buildBoardModel(
  {
    acceptanceId: null,
    content: {
      arrows: [],
      frames: [
        {
          groupId: 'g1',
          id: 'f1',
          source: { canvasId: 'cvs_1', kind: 'canvas', version: 1 },
          title: '空项目',
          x: 0,
          y: 0,
        },
      ],
      groups: [{ desc: '', id: 'g1', kind: 'journey', title: '旅程' }],
      notes: [
        {
          id: 'n1',
          kind: 'sticky',
          question: { status: 'open', suggestion: '保留' },
          text: '要保留吗？',
          x: 0,
          y: 0,
        },
      ],
    },
    id: 'art_1',
    phase: 'discuss',
    revision: 1,
  } as unknown as ArtboardItem,
  {},
);

describe('boardReference', () => {
  it('names a frame by its title', () => {
    expect(boardReference(board, 'f1', 'comment', ' 改短 ')).toEqual({
      artboardId: 'art_1',
      itemId: 'f1',
      itemKind: 'frame',
      itemTitle: '空项目',
      kind: 'comment',
      text: '改短',
    });
  });

  it('names a sticky by its text', () => {
    expect(boardReference(board, 'n1', 'decision', '保留')).toMatchObject({
      itemKind: 'note',
      itemTitle: '要保留吗？',
      kind: 'decision',
    });
  });

  it('refers to nothing for an item that is gone', () => {
    expect(boardReference(board, 'f9', 'comment', 'x')).toBeUndefined();
  });
});
