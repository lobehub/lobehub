import type { ArtboardRect } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { EDGE_LABEL_HEIGHT } from './Canvas/edgeLabel';
import { EDGE_LABEL_SLOT, EDGE_LANE_GAP, spreadEdges } from './edgeSpread';
import { computeEdgePath } from './model';

const rect = (x: number, y: number, w = 640, h = 400): ArtboardRect => ({ h, w, x, y });
const edge = (id: string, from: ArtboardRect, to: ArtboardRect, label = id) => ({
  id,
  label,
  ...computeEdgePath(from, to),
});

/** A label of a given rendered width, so collision boxes are explicit. */
const options = (width: number) => ({
  labelBox: () => ({ h: EDGE_LABEL_HEIGHT, w: width }),
  labelled: (e: { label: string }) => !!e.label,
});
const wide = options(320);
const narrow = options(12);

const labelAt = (id: string, lx: number, ly: number) => ({
  d: `M0 0 H${lx} V${ly}`,
  id,
  label: id,
  lx,
  ly,
  points: [
    [lx - 100, ly],
    [lx, ly],
    [lx, ly],
    [lx + 100, ly],
  ] as [number, number][],
  room: 400,
});

describe('spreadEdges', () => {
  it('leaves edges that share nothing untouched', () => {
    const edges = [edge('a', rect(0, 0), rect(840, 0)), edge('b', rect(0, 2000), rect(840, 2000))];

    expect(spreadEdges(edges, wide).edges).toEqual(edges);
  });

  it('gives edges that share a vertical corridor their own lanes', () => {
    const edges = [edge('a', rect(0, 0), rect(840, 700)), edge('b', rect(0, 700), rect(840, 0))];

    const [a, b] = spreadEdges(edges, wide).edges;

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

    const xs = spreadEdges(edges, wide).edges.map((e) => e.points[1][0]);

    expect(Math.min(...xs)).toBeGreaterThan(640);
    expect(Math.max(...xs)).toBeLessThan(660);
  });

  it('separates wide labels whose centres are far apart but whose glyphs overlap', () => {
    // 220px labels centred 100px apart ran straight through each other under
    // the old centre-distance heuristic.
    const edges = [labelAt('a', 400, 300), labelAt('b', 500, 300)];

    const { edges: placed, hiddenLabels } = spreadEdges(edges, wide);

    expect(hiddenLabels.size).toBe(0);
    expect(placed[0].ly).toBe(300);
    expect(Math.abs(placed[1].ly - 300)).toBe(EDGE_LABEL_HEIGHT + EDGE_LABEL_SLOT);
  });

  it('keeps narrow labels put when their boxes already clear each other', () => {
    const edges = [labelAt('a', 400, 300), labelAt('b', 500, 300)];

    const { edges: placed, hiddenLabels } = spreadEdges(edges, narrow);

    expect(hiddenLabels.size).toBe(0);
    expect(placed.map((e) => e.ly)).toEqual([300, 300]);
  });

  it('reports a label as crowded instead of drawing it over another one', () => {
    // Ten identical slots: the middle ones fit, the far ones run out of slots.
    const edges = Array.from({ length: 12 }, (_, index) => labelAt(`e${index}`, 400, 300));

    const { hiddenLabels } = spreadEdges(edges, wide);

    expect(hiddenLabels.size).toBeGreaterThan(0);
  });

  it('does not move a label away from an edge that has no text', () => {
    const edges = [
      edge('a', rect(0, 0), rect(840, 700)),
      edge('b', rect(0, 700), rect(840, 0), ''),
    ];

    const [a] = spreadEdges(edges, wide).edges;

    expect(a.ly).toBe(550);
  });

  it('moves a label off a board it would sit on', () => {
    const board = { h: 100, w: 300, x: 250, y: 250 };

    const { edges: placed, hiddenLabels } = spreadEdges([labelAt('a', 400, 300)], {
      ...wide,
      obstacles: [board],
    });

    const { ly } = placed[0];
    expect(hiddenLabels.size).toBe(0);
    expect(
      ly + EDGE_LABEL_HEIGHT / 2 <= board.y || ly - EDGE_LABEL_HEIGHT / 2 >= board.y + board.h,
    ).toBe(true);
  });

  it('hides a label that only fits on top of a board', () => {
    const board = { h: 800, w: 640, x: 80, y: -100 };

    const { hiddenLabels } = spreadEdges([labelAt('a', 400, 300)], { ...wide, obstacles: [board] });

    expect(hiddenLabels.has('a')).toBe(true);
  });
});
