import { describe, expect, it } from 'vitest';

import { EDGE_LABEL_SLOT, EDGE_LANE_GAP, spreadEdges } from './edgeSpread';
import { computeEdgePath } from './model';

const rect = (x: number, y: number, w = 640, h = 400) => ({ h, w, x, y });
const edge = (
  id: string,
  from: ReturnType<typeof rect>,
  to: ReturnType<typeof rect>,
  label = id,
) => ({
  id,
  label,
  ...computeEdgePath(from, to),
});
const labelled = (e: { label: string }) => !!e.label;

describe('spreadEdges', () => {
  it('leaves edges that share nothing untouched', () => {
    const edges = [edge('a', rect(0, 0), rect(840, 0)), edge('b', rect(0, 2000), rect(840, 2000))];

    expect(spreadEdges(edges, labelled)).toEqual(edges);
  });

  it('gives edges that share a vertical corridor their own lanes', () => {
    const edges = [edge('a', rect(0, 0), rect(840, 700)), edge('b', rect(0, 700), rect(840, 0))];

    const [a, b] = spreadEdges(edges, labelled);

    expect(b.points[1][0] - a.points[1][0]).toBe(EDGE_LANE_GAP);
    expect((a.points[1][0] + b.points[1][0]) / 2).toBe(740);
    expect(a.points[1][0]).toBe(a.points[2][0]);
    expect(a.d).toBe(`M640 200 H${a.points[1][0]} V900 H840`);
    expect(a.lx).toBe(a.points[1][0]);
  });

  it('keeps lanes inside a narrow gap', () => {
    const edges = [
      edge('a', rect(0, 0), rect(660, 700)),
      edge('b', rect(0, 700), rect(660, 0)),
      edge('c', rect(0, 350), rect(660, 1400)),
    ];

    const xs = spreadEdges(edges, labelled).map((e) => e.points[1][0]);

    expect(Math.min(...xs)).toBeGreaterThan(640);
    expect(Math.max(...xs)).toBeLessThan(660);
  });

  it('stacks labels that would land on the same spot', () => {
    const edges = [edge('a', rect(0, 0), rect(840, 700)), edge('b', rect(0, 700), rect(840, 0))];

    const [a, b] = spreadEdges(edges, labelled);

    expect(Math.abs(a.ly - b.ly)).toBe(EDGE_LABEL_SLOT);
    expect((a.ly + b.ly) / 2).toBe(550);
  });

  it('does not move a label away from an edge that has no text', () => {
    const edges = [
      edge('a', rect(0, 0), rect(840, 700)),
      edge('b', rect(0, 700), rect(840, 0), ''),
    ];

    const [a] = spreadEdges(edges, labelled);

    expect(a.ly).toBe(550);
  });
});
