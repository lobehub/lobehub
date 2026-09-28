import type { GoalGraphEdge } from '@lobechat/types';

import type { LayoutBox } from './layout';

export interface Point {
  x: number;
  y: number;
}

/** Historical continuation reads baseline → new experiment, matching its layout rank. */
export const edgeDirection = (
  edge: Pick<GoalGraphEdge, 'kind' | 'sourceNodeId' | 'targetNodeId'>,
): [string, string] =>
  ['depends_on', 'answers', 'derived_from'].includes(edge.kind)
    ? [edge.targetNodeId, edge.sourceNodeId]
    : [edge.sourceNodeId, edge.targetNodeId];

export const segmentHitsBox = (a: Point, b: Point, box: LayoutBox): boolean =>
  a.x === b.x
    ? a.x > box.x &&
      a.x < box.x + box.width &&
      Math.max(a.y, b.y) > box.y &&
      Math.min(a.y, b.y) < box.y + box.height
    : a.y > box.y &&
      a.y < box.y + box.height &&
      Math.max(a.x, b.x) > box.x &&
      Math.min(a.x, b.x) < box.x + box.width;

/** Route through free row/column gutters; frames are boundaries, leaf cards are obstacles. */
export const routeEdge = (
  source: Point,
  target: Point,
  obstacles: LayoutBox[],
  lane = 0,
): Point[] => {
  const gap = 20 + lane * 16;
  const start = { x: source.x, y: source.y + gap };
  const end = { x: target.x, y: target.y - gap };
  const clear = (a: Point, b: Point) => !obstacles.some((box) => segmentHitsBox(a, b, box));
  const xs = [
    ...new Set([start.x, end.x, ...obstacles.flatMap((b) => [b.x - 24, b.x + b.width + 24])]),
  ];
  const ys = [
    ...new Set([
      start.y,
      end.y,
      (start.y + end.y) / 2,
      ...obstacles.flatMap((b) => [b.y - 20, b.y + b.height + 20]),
    ]),
  ];
  const candidates: Point[][] = [
    ...ys.map((y) => [start, { x: start.x, y }, { x: end.x, y }, end]),
    ...xs.map((x) => [start, { x, y: start.y }, { x, y: end.y }, end]),
  ];
  const length = (path: Point[]) =>
    path
      .slice(1)
      .reduce((sum, p, i) => sum + Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y), 0);
  const valid = (path: Point[]) => path.slice(1).every((p, i) => clear(path[i], p));
  let middle = candidates.filter(valid).sort((a, b) => length(a) - length(b))[0];
  // Irregular nested layouts may need a second gutter before the final approach.
  if (!middle) {
    const more: Point[][] = [];
    for (const x of xs)
      for (const y of ys) {
        const p = [start, { x: start.x, y }, { x, y }, { x, y: end.y }, end];
        if (valid(p)) more.push(p);
        const q = [start, { x, y: start.y }, { x, y }, { x: end.x, y }, end];
        if (valid(q)) more.push(q);
      }
    middle = more.sort((a, b) => length(a) - length(b))[0];
  }
  // Retain a visible relation even for an externally supplied overlapping layout.
  const path = [source, ...(middle ?? [start, end]), target];
  return path.filter((p, i) => i === 0 || p.x !== path[i - 1].x || p.y !== path[i - 1].y);
};

export const edgeLabelPoint = (path: Point[]): Point => {
  const segments = path.slice(2, -1).map((p, i) => ({ a: path[i + 1], b: p }));
  const horizontal = segments.filter((s) => s.a.y === s.b.y && Math.abs(s.a.x - s.b.x) > 80);
  const chosen = (horizontal.length ? horizontal : segments).sort(
    (a, b) =>
      Math.abs(b.a.x - b.b.x) +
      Math.abs(b.a.y - b.b.y) -
      (Math.abs(a.a.x - a.b.x) + Math.abs(a.a.y - a.b.y)),
  )[0];
  return chosen ? { x: (chosen.a.x + chosen.b.x) / 2, y: (chosen.a.y + chosen.b.y) / 2 } : path[0];
};
