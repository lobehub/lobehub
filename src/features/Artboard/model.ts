import {
  ARTBOARD_BOARD_SIZE,
  type ArtboardBoardView,
  type ArtboardEdgeView,
  type ArtboardGroupView,
  type ArtboardItem,
  artboardJourneyOf,
  type ArtboardRect,
} from '@lobechat/types';

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
}

export type BoardEdge = ArtboardEdgeView & EdgePath;

export type BoardBlocker =
  | { id: string; kind: 'round'; text: string }
  | { boardId: string | null; id: string; kind: 'question'; text: string };

export interface BoardModel {
  artboard: ArtboardItem;
  blockers: BoardBlocker[];
  boardById: Record<string, ArtboardBoardView>;
  boards: ArtboardBoardView[];
  bounds: Rect;
  edges: BoardEdge[];
  finalized: boolean;
  groups: ArtboardGroupView[];
  imageUrls: Record<string, string>;
  journeyBoards: ArtboardBoardView[];
  journeyEdges: ArtboardEdgeView[];
  journeyEntryId: string | undefined;
  journeyGroupId: string | undefined;
  pageId: string | undefined;
  recommendedIds: Set<string>;
}

export const computeEdgePath = (from: ArtboardRect, to: ArtboardRect): EdgePath => {
  const right = to.x >= from.x + from.w;
  const left = to.x + to.w <= from.x;

  if (right || left) {
    const x1 = right ? from.x + from.w : from.x;
    const x2 = right ? to.x : to.x + to.w;
    const y1 = from.y + from.h / 2;
    const y2 = to.y + to.h / 2;
    const mx = (x1 + x2) / 2;
    return { d: `M${x1} ${y1} H${mx} V${y2} H${x2}`, lx: mx, ly: (y1 + y2) / 2 };
  }

  const down = to.y >= from.y;
  const x1 = from.x + from.w / 2;
  const x2 = to.x + to.w / 2;
  const y1 = down ? from.y + from.h : from.y;
  const y2 = down ? to.y : to.y + to.h;
  const my = (y1 + y2) / 2;
  return { d: `M${x1} ${y1} V${my} H${x2} V${y2}`, lx: (x1 + x2) / 2, ly: my };
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

export const buildBoardModel = (
  artboard: ArtboardItem,
  imageUrls: Record<string, string>,
): BoardModel => {
  const { content } = artboard;
  const pageId = content.pages[0]?.id;
  const boardById = Object.fromEntries(content.boards.map((b) => [b.id, b]));

  const boards = content.boards.filter((b) => b.pageId === pageId);
  const groups = content.groups.filter((g) => g.pageId === pageId);
  const onPage = new Set(boards.map((b) => b.id));
  const edges = content.edges.flatMap((edge) =>
    onPage.has(edge.from) && onPage.has(edge.to)
      ? [{ ...edge, ...computeEdgePath(boardById[edge.from].rect, boardById[edge.to].rect) }]
      : [],
  );

  const journey = artboardJourneyOf(content);
  const journeyBoards = journey.boards ?? [];
  const journeyEdges = journey.edges ?? [];
  const targets = new Set(journeyEdges.map((e) => e.to));
  const entries = journeyBoards.filter((b) => !targets.has(b.id));

  return {
    artboard,
    blockers: [
      ...content.rounds
        .filter((round) => round.status === 'open')
        .map((round) => ({ id: round.id, kind: 'round' as const, text: round.title })),
      ...content.questions.map((question) => ({
        boardId: question.boardId,
        id: question.id,
        kind: 'question' as const,
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
    groups,
    imageUrls,
    journeyBoards,
    journeyEdges,
    journeyEntryId: entries.length === 1 ? entries[0].id : undefined,
    journeyGroupId: journey.group?.id,
    pageId,
    recommendedIds: new Set(
      content.rounds.flatMap((round) =>
        round.recommendedBoardId ? [round.recommendedBoardId] : [],
      ),
    ),
  };
};
