import type {
  ArtboardBoardView,
  ArtboardContent,
  ArtboardEdgeView,
  ArtboardItem,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { boardFileUrl, buildBoardModel, computeEdgePath } from './model';

const rect = (x: number, y: number, w = 640, h = 400) => ({ h, w, x, y });

describe('computeEdgePath', () => {
  it('leaves the right edge and enters the left edge when the target is to the right', () => {
    expect(computeEdgePath(rect(0, 0), rect(840, 0))).toEqual({
      d: 'M640 200 H740 V200 H840',
      lx: 740,
      ly: 200,
      room: 200,
      points: [
        [640, 200],
        [740, 200],
        [740, 200],
        [840, 200],
      ],
    });
  });

  it('runs right to left when the target is to the left', () => {
    expect(computeEdgePath(rect(1680, 0), rect(840, 0))).toEqual({
      d: 'M1680 200 H1580 V200 H1480',
      lx: 1580,
      ly: 200,
      room: 200,
      points: [
        [1680, 200],
        [1580, 200],
        [1580, 200],
        [1480, 200],
      ],
    });
  });

  it('goes vertical when the boards overlap horizontally', () => {
    expect(computeEdgePath(rect(0, 0), rect(100, 600))).toEqual({
      d: 'M320 400 V500 H420 V600',
      lx: 370,
      ly: 500,
      room: 640,
      points: [
        [320, 400],
        [320, 500],
        [420, 500],
        [420, 600],
      ],
    });
  });

  it('anchors on each board’s own size', () => {
    expect(computeEdgePath(rect(0, 0, 200, 100), rect(400, 0, 300, 300))).toEqual({
      d: 'M200 50 H300 V150 H400',
      lx: 300,
      ly: 100,
      room: 200,
      points: [
        [200, 50],
        [300, 50],
        [300, 150],
        [400, 150],
      ],
    });
  });

  const crosses = (points: [number, number][], r: ReturnType<typeof rect>) =>
    points.slice(1).some(([bx, by], i) => {
      const [ax, ay] = points[i];
      if (ay === by)
        return ay > r.y && ay < r.y + r.h && Math.min(ax, bx) < r.x + r.w && Math.max(ax, bx) > r.x;
      return ax > r.x && ax < r.x + r.w && Math.min(ay, by) < r.y + r.h && Math.max(ay, by) > r.y;
    });

  it('goes around a board that sits between two boards in a row', () => {
    const from = rect(0, 100, 260, 160);
    const between = rect(400, 0);
    const to = rect(1200, 0);

    const path = computeEdgePath(from, to, [from, between, to]);

    expect(crosses(path.points, between)).toBe(false);
    expect(path.points[0]).toEqual([130, 260]);
    expect(path.points.at(-1)).toEqual([1520, 400]);
    expect(path.ly).toBeGreaterThan(400);
  });

  it('goes around a board that sits between two stacked boards', () => {
    const from = rect(0, 0);
    const between = rect(0, 600);
    const to = rect(0, 1200);

    const path = computeEdgePath(from, to, [from, between, to]);

    expect(crosses(path.points, between)).toBe(false);
    expect(path.lx).toBeGreaterThan(640);
  });

  it('keeps the direct route when nothing is in the way', () => {
    expect(
      computeEdgePath(rect(0, 0), rect(840, 0), [rect(0, 0), rect(840, 0), rect(0, 900)]),
    ).toEqual(computeEdgePath(rect(0, 0), rect(840, 0)));
  });
});

const board = (id: string, patch: Partial<ArtboardBoardView> = {}): ArtboardBoardView => ({
  expected: null,
  flowNodeId: null,
  groupId: 'g2',
  id,
  pageId: 'p1',
  rect: rect(0, 0),
  roundId: null,
  source: { hash: 'h1', kind: 'file', path: 'pages/b.html' },
  title: id,
  type: 'html',
  ...patch,
});

const edge = (id: string, from: string, to: string): ArtboardEdgeView => ({
  condition: null,
  flowEdgeId: null,
  from,
  id,
  isDefault: false,
  label: id,
  to,
});

const content: ArtboardContent = {
  boards: [
    board('b1', { expected: '能看到入口' }),
    board('b2', { rect: rect(840, 0), source: { fileId: 'file_1', kind: 'image' } }),
    board('b3', { groupId: 'g1', rect: rect(0, 1000), roundId: 'r1' }),
    board('b4', { groupId: null, pageId: 'p2', rect: rect(9000, 9000) }),
  ],
  edges: [edge('e1', 'b1', 'b2'), edge('e2', 'b1', 'gone'), edge('e3', 'b1', 'b4')],
  groups: [
    {
      desc: '',
      id: 'g1',
      kind: 'options',
      pageId: 'p1',
      rect: rect(-48, 856, 736, 592),
      title: '方案',
    },
    {
      desc: '',
      id: 'g2',
      kind: 'journey',
      pageId: 'p1',
      rect: rect(-48, -144, 1576, 592),
      title: '旅程',
    },
    {
      desc: '',
      id: 'g3',
      kind: 'references',
      pageId: 'p2',
      rect: rect(0, 0, 10, 10),
      title: '参考',
    },
  ],
  pages: [
    { id: 'p1', name: 'Page 1', sortOrder: 0 },
    { id: 'p2', name: 'Page 2', sortOrder: 1 },
  ],
  questions: [
    {
      answered: false,
      boardId: 'b1',
      content: '要保留吗？',
      groupId: null,
      id: 'c1',
      pageId: 'p1',
    },
    {
      answered: true,
      boardId: 'b1',
      content: '要加按钮吗？',
      groupId: null,
      id: 'c2',
      pageId: 'p1',
    },
  ],
  rounds: [
    {
      batchId: null,
      chosenBoardId: null,
      id: 'r1',
      pageId: 'p1',
      recommendedBoardId: 'b3',
      status: 'open',
      title: '布局',
    },
    {
      batchId: null,
      chosenBoardId: 'b3',
      id: 'r2',
      pageId: 'p1',
      recommendedBoardId: null,
      status: 'submitted',
      title: '配色',
    },
  ],
};

const item = {
  acceptanceId: null,
  content,
  id: 'art_1',
  phase: 'discuss',
  revision: 3,
  taskId: 'task_1',
  title: '首次进入',
} as ArtboardItem;

describe('buildBoardModel', () => {
  const model = buildBoardModel(item, '/artboard-files/tok/');

  it('shows the boards, groups and edges of the first page only', () => {
    expect(model.pageId).toBe('p1');
    expect(model.boards.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(model.groups.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(model.edges.map((e) => e.id)).toEqual(['e1']);
  });

  it('still finds a board of another page by id', () => {
    expect(model.boardById.b4.pageId).toBe('p2');
  });

  it('finds the single journey, its boards, edges and entry', () => {
    expect(model.journeyGroupId).toBe('g2');
    expect(model.journeyBoards.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(model.journeyEdges.map((e) => e.id)).toEqual(['e1']);
    expect(model.journeyEntryId).toBe('b1');
  });

  it('has no journey when the board holds two', () => {
    const twice = buildBoardModel(
      {
        ...item,
        content: {
          ...content,
          groups: [...content.groups, { ...content.groups[1], id: 'g4', title: '另一条' }],
        },
      },
      {},
    );
    expect(twice.journeyGroupId).toBeUndefined();
    expect(twice.journeyBoards).toEqual([]);
  });

  it('lays an edge out between its two boards', () => {
    expect(model.edges[0]).toMatchObject({ d: 'M640 200 H740 V200 H840', lx: 740, ly: 200 });
  });

  it('marks the board a round recommends', () => {
    expect([...model.recommendedIds]).toEqual(['b3']);
  });

  it('lists open rounds and unanswered agent questions as what blocks finalizing', () => {
    expect(model.blockers).toEqual([
      { groupId: 'g1', id: 'r1', kind: 'round', pageId: 'p1', text: '布局' },
      {
        answered: false,
        boardId: 'b1',
        id: 'c1',
        kind: 'question',
        pageId: 'p1',
        text: '要保留吗？',
      },
      {
        answered: true,
        boardId: 'b1',
        id: 'c2',
        kind: 'question',
        pageId: 'p1',
        text: '要加按钮吗？',
      },
    ]);
  });

  it('shows another page when asked, and falls back to the first for an unknown one', () => {
    const second = buildBoardModel(item, null, 'p2');
    expect(second.pageId).toBe('p2');
    expect(second.boards.map((b) => b.id)).toEqual(['b4']);
    expect(second.groups.map((g) => g.id)).toEqual(['g3']);
    expect(second.pages.map((p) => p.name)).toEqual(['Page 1', 'Page 2']);
    expect(buildBoardModel(item, null, 'gone').pageId).toBe('p1');
  });

  it('knows the page of any board, group or round, whatever page is shown', () => {
    expect(model.pageIdOf('b4')).toBe('p2');
    expect(model.pageIdOf('g3')).toBe('p2');
    expect(model.pageIdOf('r1')).toBe('p1');
    expect(model.pageIdOf('nope')).toBeUndefined();
  });

  it('ties an options group to its round and lists the rounds still open', () => {
    expect(model.roundByGroupId.g1.id).toBe('r1');
    expect(model.roundByGroupId.g2).toBeUndefined();
    expect(model.openRounds.map((r) => r.id)).toEqual(['r1']);
  });

  it('bounds the groups and the boards outside any group on the page', () => {
    expect(model.bounds).toEqual({ maxX: 1528, maxY: 1448, minX: -48, minY: -144 });
    const loose = buildBoardModel(
      {
        ...item,
        content: {
          ...content,
          boards: [board('x', { groupId: null, rect: rect(3000, 0, 100, 50) })],
        },
      },
      {},
    );
    expect(loose.bounds.maxX).toBe(3100);
  });
});

describe('boardFileUrl', () => {
  it('joins the base URL and the encoded path of the file a board shows', () => {
    const model = buildBoardModel(item, '/artboard-files/tok/');

    expect(
      boardFileUrl(
        model,
        board('x', { source: { hash: '0123456789abcdef', kind: 'file', path: 'shots/a@2x.png' } }),
      ),
    ).toBe('/artboard-files/tok/shots/a%402x.png?v=0123456789ab');
  });

  it('has no URL without a base URL or a source', () => {
    expect(boardFileUrl(buildBoardModel(item, null), board('x'))).toBeUndefined();
    expect(
      boardFileUrl(buildBoardModel(item, '/artboard-files/tok/'), board('x', { source: null })),
    ).toBeUndefined();
  });

  it('has no URL for a board whose file does not exist yet', () => {
    expect(
      boardFileUrl(
        buildBoardModel(item, '/artboard-files/tok/'),
        board('x', { source: { hash: null, kind: 'file', path: 'pages/a.html' } }),
      ),
    ).toBeUndefined();
  });
});
