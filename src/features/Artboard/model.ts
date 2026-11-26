import {
  ARTBOARD_BOARD_SIZE,
  type ArtboardBoardView,
  type ArtboardEdgeView,
  type ArtboardGroupView,
  type ArtboardItem,
  artboardJourneyOf,
  type ArtboardPageView,
  type ArtboardRect,
  type ArtboardRoundView,
} from '@lobechat/types';

import {
  EDGE_LABEL_HEIGHT,
  EDGE_LABEL_MAX_WIDTH,
  edgeLabelText,
  edgeLabelWidth,
} from './Canvas/edgeLabel';
import { spreadEdges } from './edgeSpread';

export interface Rect {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export interface EdgePath {
  d: string;
  lx: number;
  ly: number;
  points: [number, number][];
  room: number;
}

export type BoardEdge = ArtboardEdgeView &
  EdgePath & {
    /** Layout found no free slot at this zoom: only hover/selection reveals it. */
    labelHidden?: boolean;
  };

export type BoardBlocker =
  | { groupId: string | null; id: string; kind: 'round'; pageId: string; text: string }
  | {
      answered: boolean;
      boardId: string | null;
      id: string;
      kind: 'question';
      pageId: string | null;
      text: string;
    };

export interface BoardModel {
  artboard: ArtboardItem;
  blockers: BoardBlocker[];
  boardById: Record<string, ArtboardBoardView>;
  boards: ArtboardBoardView[];
  bounds: Rect;
  edges: BoardEdge[];
  fileBaseUrl: string | null;
  finalized: boolean;
  groups: ArtboardGroupView[];
  journeyBoards: ArtboardBoardView[];
  journeyEdges: ArtboardEdgeView[];
  journeyEntryId: string | undefined;
  journeyGroupId: string | undefined;
  openRounds: ArtboardRoundView[];
  pageId: string | undefined;
  pageIdOf: (id: string) => string | undefined;
  pages: ArtboardPageView[];
  recommendedIds: Set<string>;
  roundByGroupId: Record<string, ArtboardRoundView>;
}

const DETOUR_GAP = 40;

type Point = [number, number];

const segmentHits = ([ax, ay]: Point, [bx, by]: Point, r: ArtboardRect) =>
  ay === by
    ? ay > r.y && ay < r.y + r.h && Math.min(ax, bx) < r.x + r.w && Math.max(ax, bx) > r.x
    : ax > r.x && ax < r.x + r.w && Math.min(ay, by) < r.y + r.h && Math.max(ay, by) > r.y;

const crossing = (points: Point[], rects: ArtboardRect[]) =>
  rects.filter((r) => points.slice(1).some((point, i) => segmentHits(points[i], point, r)));

const aroundBelowOrAbove = (from: ArtboardRect, to: ArtboardRect, blocking: ArtboardRect[]) => {
  const x1 = from.x + from.w / 2;
  const x2 = to.x + to.w / 2;
  const below = Math.max(...[from, to, ...blocking].map((r) => r.y + r.h)) + DETOUR_GAP;
  const above = Math.min(...[from, to, ...blocking].map((r) => r.y)) - DETOUR_GAP;
  return [
    [from.y + from.h, below, to.y + to.h],
    [from.y, above, to.y],
  ].map(([y1, y, y2]): EdgePath => ({
    d: `M${x1} ${y1} V${y} H${x2} V${y2}`,
    lx: (x1 + x2) / 2,
    ly: y,
    points: [
      [x1, y1],
      [x1, y],
      [x2, y],
      [x2, y2],
    ],
    room: Math.abs(x2 - x1),
  }));
};

const aroundRightOrLeft = (from: ArtboardRect, to: ArtboardRect, blocking: ArtboardRect[]) => {
  const y1 = from.y + from.h / 2;
  const y2 = to.y + to.h / 2;
  const right = Math.max(...[from, to, ...blocking].map((r) => r.x + r.w)) + DETOUR_GAP;
  const left = Math.min(...[from, to, ...blocking].map((r) => r.x)) - DETOUR_GAP;
  return [
    [from.x + from.w, right, to.x + to.w],
    [from.x, left, to.x],
  ].map(([x1, x, x2]): EdgePath => ({
    d: `M${x1} ${y1} H${x} V${y2} H${x2}`,
    lx: x,
    ly: (y1 + y2) / 2,
    points: [
      [x1, y1],
      [x, y1],
      [x, y2],
      [x2, y2],
    ],
    room: DETOUR_GAP * 2,
  }));
};

const sameRect = (a: ArtboardRect, b: ArtboardRect) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export const computeEdgePath = (
  from: ArtboardRect,
  to: ArtboardRect,
  obstacles: ArtboardRect[] = [],
): EdgePath => {
  const direct = directEdgePath(from, to);
  const others = obstacles.filter((r) => !sameRect(r, from) && !sameRect(r, to));
  const blocking = crossing(direct.points, others);
  if (!blocking.length) return direct;

  const sideBySide = to.x >= from.x + from.w || to.x + to.w <= from.x;
  const detours = (sideBySide ? aroundBelowOrAbove : aroundRightOrLeft)(from, to, blocking);
  // Below before above: board titles sit on top of each board.
  return detours.find((path) => !crossing(path.points, others).length) ?? direct;
};

const directEdgePath = (from: ArtboardRect, to: ArtboardRect): EdgePath => {
  const right = to.x >= from.x + from.w;
  const left = to.x + to.w <= from.x;

  if (right || left) {
    const x1 = right ? from.x + from.w : from.x;
    const x2 = right ? to.x : to.x + to.w;
    const y1 = from.y + from.h / 2;
    const y2 = to.y + to.h / 2;
    const mx = (x1 + x2) / 2;
    return {
      d: `M${x1} ${y1} H${mx} V${y2} H${x2}`,
      lx: mx,
      ly: (y1 + y2) / 2,
      points: [
        [x1, y1],
        [mx, y1],
        [mx, y2],
        [x2, y2],
      ],
      room: Math.abs(x2 - x1),
    };
  }

  const down = to.y >= from.y;
  const x1 = from.x + from.w / 2;
  const x2 = to.x + to.w / 2;
  const y1 = down ? from.y + from.h : from.y;
  const y2 = down ? to.y : to.y + to.h;
  const my = (y1 + y2) / 2;
  return {
    d: `M${x1} ${y1} V${my} H${x2} V${y2}`,
    lx: (x1 + x2) / 2,
    ly: my,
    points: [
      [x1, y1],
      [x1, my],
      [x2, my],
      [x2, y2],
    ],
    room: Math.min(from.w, to.w),
  };
};

export const toBounds = (rect: ArtboardRect): Rect => ({
  maxX: rect.x + rect.w,
  maxY: rect.y + rect.h,
  minX: rect.x,
  minY: rect.y,
});

const EMPTY_BOUNDS: Rect = {
  maxX: ARTBOARD_BOARD_SIZE.width,
  maxY: ARTBOARD_BOARD_SIZE.height,
  minX: 0,
  minY: 0,
};

const union = (rects: Rect[]): Rect =>
  rects.length
    ? {
        maxX: Math.max(...rects.map((r) => r.maxX)),
        maxY: Math.max(...rects.map((r) => r.maxY)),
        minX: Math.min(...rects.map((r) => r.minX)),
        minY: Math.min(...rects.map((r) => r.minY)),
      }
    : EMPTY_BOUNDS;

export const boardFileUrl = (
  model: Pick<BoardModel, 'fileBaseUrl'>,
  board: Pick<ArtboardBoardView, 'source'>,
): string | undefined =>
  model.fileBaseUrl && board.source?.hash
    ? `${model.fileBaseUrl}${board.source.path.split('/').map(encodeURIComponent).join('/')}?v=${board.source.hash.slice(0, 12)}`
    : undefined;

export const buildBoardModel = (
  artboard: ArtboardItem,
  fileBaseUrl: string | null,
  requestedPageId?: string | null,
): BoardModel => {
  const { content } = artboard;
  const pageId = (content.pages.find((p) => p.id === requestedPageId) ?? content.pages[0])?.id;
  const boardById = Object.fromEntries(content.boards.map((b) => [b.id, b]));

  const boards = content.boards.filter((b) => b.pageId === pageId);
  const groups = content.groups.filter((g) => g.pageId === pageId);
  const onPage = new Set(boards.map((b) => b.id));
  const spread = spreadEdges(
    content.edges.flatMap((edge) =>
      onPage.has(edge.from) && onPage.has(edge.to)
        ? [
            {
              ...edge,
              ...computeEdgePath(
                boardById[edge.from].rect,
                boardById[edge.to].rect,
                boards.map((b) => b.rect),
              ),
            },
          ]
        : [],
    ),
    {
      labelBox: (edge) => ({
        h: EDGE_LABEL_HEIGHT,
        w: Math.min(edgeLabelWidth(edgeLabelText(edge)), Math.min(edge.room, EDGE_LABEL_MAX_WIDTH)),
      }),
      labelled: (edge) => !!(edge.label || edge.condition),
      obstacles: boards.map((b) => b.rect),
    },
  );
  const edges: BoardEdge[] = spread.edges.map((edge) =>
    spread.hiddenLabels.has(edge.id) ? { ...edge, labelHidden: true } : edge,
  );

  const journey = artboardJourneyOf(content);
  const journeyBoards = journey.boards ?? [];
  const journeyEdges = journey.edges ?? [];
  const targets = new Set(journeyEdges.map((e) => e.to));
  const entries = journeyBoards.filter((b) => !targets.has(b.id));

  const roundById = Object.fromEntries(content.rounds.map((r) => [r.id, r]));
  const roundByGroupId: Record<string, ArtboardRoundView> = {};
  const groupIdByRound: Record<string, string> = {};
  for (const b of content.boards) {
    if (!b.roundId || !b.groupId || !roundById[b.roundId]) continue;
    roundByGroupId[b.groupId] = roundById[b.roundId];
    groupIdByRound[b.roundId] = b.groupId;
  }
  const openRounds = content.rounds.filter((round) => round.status === 'open');
  const pageIds = new Map<string, string>(
    [...content.boards, ...content.groups, ...content.rounds].map((x) => [x.id, x.pageId]),
  );

  return {
    artboard,
    blockers: [
      ...openRounds.map((round) => ({
        groupId: groupIdByRound[round.id] ?? null,
        id: round.id,
        kind: 'round' as const,
        pageId: round.pageId,
        text: round.title,
      })),
      ...content.questions.map((question) => ({
        answered: question.answered,
        boardId: question.boardId,
        id: question.id,
        kind: 'question' as const,
        pageId: question.pageId,
        text: question.content,
      })),
    ],
    boardById,
    boards,
    bounds: union([
      ...groups.map((g) => toBounds(g.rect)),
      ...boards.filter((b) => !b.groupId).map((b) => toBounds(b.rect)),
    ]),
    edges,
    finalized: artboard.phase === 'finalized',
    fileBaseUrl,
    groups,
    journeyBoards,
    journeyEdges,
    journeyEntryId: entries.length === 1 ? entries[0].id : undefined,
    journeyGroupId: journey.group?.id,
    openRounds,
    pageId,
    pageIdOf: (id) => pageIds.get(id),
    pages: content.pages,
    recommendedIds: new Set(
      content.rounds.flatMap((round) =>
        round.recommendedBoardId ? [round.recommendedBoardId] : [],
      ),
    ),
    roundByGroupId,
  };
};
