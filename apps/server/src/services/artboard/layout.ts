import type { ArtboardRect } from '@lobechat/types';

const GROUP_PADDING = { bottom: 48, left: 48, right: 48, top: 144 };

export const EMPTY_GROUP_RECT: ArtboardRect = { h: 0, w: 0, x: 0, y: 0 };

export const wrapBoards = (rects: ArtboardRect[]): ArtboardRect => {
  if (!rects.length) return EMPTY_GROUP_RECT;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return {
    h: maxY - minY + GROUP_PADDING.top + GROUP_PADDING.bottom,
    w: maxX - minX + GROUP_PADDING.left + GROUP_PADDING.right,
    x: minX - GROUP_PADDING.left,
    y: minY - GROUP_PADDING.top,
  };
};

type Origin = Pick<ArtboardRect, 'x' | 'y'>;

export const toPageRect = (rect: ArtboardRect, origin?: Origin): ArtboardRect =>
  origin ? { ...rect, x: rect.x + origin.x, y: rect.y + origin.y } : rect;

export const toGroupRect = (rect: ArtboardRect, origin?: Origin): ArtboardRect =>
  origin ? { ...rect, x: rect.x - origin.x, y: rect.y - origin.y } : rect;

export const sameRect = (a: ArtboardRect, b: ArtboardRect) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export const rectsOverlap = (a: ArtboardRect, b: ArtboardRect) =>
  a.w > 0 &&
  a.h > 0 &&
  b.w > 0 &&
  b.h > 0 &&
  a.x < b.x + b.w &&
  b.x < a.x + a.w &&
  a.y < b.y + b.h &&
  b.y < a.y + a.h;
