import type {
  ArtboardBoardView,
  ArtboardContent,
  ArtboardEdgeView,
  ArtboardItem,
} from '@lobechat/types';

import { buildBoardModel } from '../model';

export const testBoard = (
  id: string,
  patch: Partial<ArtboardBoardView> = {},
): ArtboardBoardView => ({
  expected: `${id} works`,
  flowNodeId: null,
  groupId: 'g1',
  id,
  pageId: 'p1',
  rect: { h: 400, w: 640, x: 0, y: 0 },
  roundId: null,
  source: { canvasId: `cvs_${id}`, kind: 'canvas', version: 1 },
  title: id,
  type: 'html',
  ...patch,
});

export const testEdge = (
  id: string,
  from: string,
  to: string,
  patch: Partial<ArtboardEdgeView> = {},
): ArtboardEdgeView => ({
  condition: null,
  flowEdgeId: null,
  from,
  id,
  isDefault: false,
  label: id,
  to,
  ...patch,
});

export const testModel = (
  content: Pick<ArtboardContent, 'boards' | 'edges'>,
  artboard: Partial<ArtboardItem> = {},
) =>
  buildBoardModel(
    {
      content: {
        ...content,
        groups: [
          {
            desc: '',
            id: 'g1',
            kind: 'journey',
            pageId: 'p1',
            rect: { h: 0, w: 0, x: 0, y: 0 },
            title: '旅程',
          },
          {
            desc: '',
            id: 'g2',
            kind: 'options',
            pageId: 'p1',
            rect: { h: 0, w: 0, x: 0, y: 0 },
            title: '方案',
          },
        ],
        pages: [{ id: 'p1', name: 'Page 1', sortOrder: 0 }],
        questions: [],
        rounds: [],
      },
      id: 'art_1',
      phase: 'discuss',
      revision: 1,
      ...artboard,
    } as ArtboardItem,
    {},
  );
