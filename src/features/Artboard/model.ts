import {
  ARTBOARD_FRAME_SIZE,
  type ArtboardArrow,
  type ArtboardFrame,
  type ArtboardGroup,
  type ArtboardItem,
  type ArtboardNote,
} from '@lobechat/types';

export const FRAME_W = ARTBOARD_FRAME_SIZE.width;
export const FRAME_H = ARTBOARD_FRAME_SIZE.height;
export const NOTE_W = 300;
export const NOTE_H = 112;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export interface GroupRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

export interface ArrowPath {
  d: string;
  lx: number;
  ly: number;
}

export type BoardArrow = ArtboardArrow & ArrowPath;

export interface BoardModel {
  arrows: BoardArrow[];
  artboard: ArtboardItem;
  bounds: Rect;
  finalized: boolean;
  frameById: Record<string, ArtboardFrame>;
  frames: ArtboardFrame[];
  groupRects: Record<string, GroupRect>;
  groups: ArtboardGroup[];
  imageUrls: Record<string, string>;
  journeyArrows: BoardArrow[];
  journeyEntryId: string | undefined;
  journeyFrames: ArtboardFrame[];
  journeyGroupId: string | undefined;
  noteById: Record<string, ArtboardNote>;
  notes: ArtboardNote[];
  openQuestions: ArtboardNote[];
  questions: ArtboardNote[];
}

export const computeArrowPath = (from: Point, to: Point): ArrowPath => {
  const right = to.x >= from.x + FRAME_W;
  const left = to.x + FRAME_W <= from.x;

  if (right || left) {
    const x1 = right ? from.x + FRAME_W : from.x;
    const x2 = right ? to.x : to.x + FRAME_W;
    const y1 = from.y + FRAME_H / 2;
    const y2 = to.y + FRAME_H / 2;
    const mx = (x1 + x2) / 2;
    return { d: `M${x1} ${y1} H${mx} V${y2} H${x2}`, lx: mx, ly: (y1 + y2) / 2 };
  }

  const down = to.y >= from.y;
  const x1 = from.x + FRAME_W / 2;
  const x2 = to.x + FRAME_W / 2;
  const y1 = down ? from.y + FRAME_H : from.y;
  const y2 = down ? to.y : to.y + FRAME_H;
  const my = (y1 + y2) / 2;
  return { d: `M${x1} ${y1} V${my} H${x2} V${y2}`, lx: (x1 + x2) / 2, ly: my };
};

const wrapFrames = (frames: ArtboardFrame[]): GroupRect => {
  const minX = Math.min(...frames.map((f) => f.x));
  const minY = Math.min(...frames.map((f) => f.y));
  const maxX = Math.max(...frames.map((f) => f.x)) + FRAME_W;
  const maxY = Math.max(...frames.map((f) => f.y)) + FRAME_H;
  return { h: maxY - minY + 112, w: maxX - minX + 96, x: minX - 48, y: minY - 64 };
};

export const noteRect = (note: ArtboardNote): Rect => ({
  maxX: note.x + (note.w ?? NOTE_W),
  maxY: note.y + NOTE_H,
  minX: note.x,
  minY: note.y,
});

export const frameRect = (frame: Point): Rect => ({
  maxX: frame.x + FRAME_W,
  maxY: frame.y + FRAME_H,
  minX: frame.x,
  minY: frame.y,
});

const EMPTY_BOUNDS: Rect = { maxX: FRAME_W, maxY: FRAME_H, minX: 0, minY: 0 };

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
  const { arrows, frames, groups, notes } = artboard.content;
  const frameById = Object.fromEntries(frames.map((f) => [f.id, f]));
  const noteById = Object.fromEntries(notes.map((n) => [n.id, n]));

  const groupRects: Record<string, GroupRect> = {};
  for (const group of groups) {
    const members = frames.filter((f) => f.groupId === group.id);
    if (members.length) groupRects[group.id] = wrapFrames(members);
  }

  const journeys = groups.filter((g) => g.kind === 'journey');
  const journeyGroupId = journeys.length === 1 ? journeys[0].id : undefined;
  const journeyFrames = frames.filter((f) => f.groupId === journeyGroupId);
  const journeyIds = new Set(journeyFrames.map((f) => f.id));
  const laidOut = arrows.flatMap((arrow) => {
    const from = frameById[arrow.from];
    const to = frameById[arrow.to];
    return from && to ? [{ ...arrow, ...computeArrowPath(from, to) }] : [];
  });
  const journeyArrows = laidOut.filter((a) => journeyIds.has(a.from) && journeyIds.has(a.to));
  const targets = new Set(journeyArrows.map((a) => a.to));
  const entries = journeyFrames.filter((f) => !targets.has(f.id));
  const questions = notes.filter((n) => n.question);

  return {
    arrows: laidOut,
    artboard,
    bounds: union([
      ...Object.values(groupRects).map((r) => ({
        maxX: r.x + r.w,
        maxY: r.y + r.h,
        minX: r.x,
        minY: r.y,
      })),
      ...notes.map(noteRect),
    ]),
    finalized: artboard.phase === 'finalized',
    frameById,
    frames,
    groupRects,
    groups,
    imageUrls,
    journeyArrows,
    journeyEntryId: entries.length === 1 ? entries[0].id : undefined,
    journeyFrames,
    journeyGroupId,
    noteById,
    notes,
    openQuestions: questions.filter((n) => n.question?.status === 'open'),
    questions,
  };
};
