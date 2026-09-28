import { describe, expect, it } from 'vitest';

import { edgeDirection, routeEdge, segmentHitsBox } from './edgeRouting';
import { experimentStatusVisual } from './experimentStatus';

const boxes = [
  { x: -115, y: 0, width: 230, height: 98 },
  { x: -292, y: 174, width: 260, height: 112 },
  { x: 32, y: 174, width: 260, height: 112 },
  { x: -292, y: 382, width: 260, height: 112 },
  { x: 32, y: 382, width: 260, height: 112 },
];

describe('exploration relations and status', () => {
  it('draws historical continuation in the same baseline-to-successor direction used by ranking', () => {
    expect(
      edgeDirection({ kind: 'derived_from', sourceNodeId: 'new', targetNodeId: 'baseline' }),
    ).toEqual(['baseline', 'new']);
    expect(
      edgeDirection({ kind: 'supports', sourceNodeId: 'finding', targetNodeId: 'experiment' }),
    ).toEqual(['finding', 'experiment']);
  });
  it('routes skip-level relations around measured experiment cards', () => {
    for (const target of [
      { x: -162, y: 382 },
      { x: 162, y: 382 },
    ]) {
      const points = routeEdge({ x: 0, y: 98 }, target, boxes);
      expect(points[0]).toEqual({ x: 0, y: 98 });
      expect(points.at(-1)).toEqual(target);
      for (let i = 1; i < points.length; i++) {
        expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true);
        expect(boxes.some((box) => segmentHitsBox(points[i - 1], points[i], box))).toBe(false);
      }
    }
  });
  it('separates parallel provenance links while preserving both endpoints', () => {
    const source = { x: -162, y: 286 },
      target = { x: 162, y: 382 };
    const first = routeEdge(source, target, boxes);
    const second = routeEdge(source, target, boxes, 1);
    expect(first).not.toEqual(second);
    expect(first[0]).toEqual(second[0]);
    expect(first.at(-1)).toEqual(second.at(-1));
  });
  it('never uses the running-ring fallback for waiting, completed or unstarted experiments', () => {
    const states = ['proposed', 'waiting', 'resolved'] as const;
    expect(states.every((s) => experimentStatusVisual(s).icon)).toBe(true);
    expect(new Set(states.map((s) => experimentStatusVisual(s).icon)).size).toBe(3);
    expect(new Set(states.map((s) => experimentStatusVisual(s).color)).size).toBe(3);
  });
});
