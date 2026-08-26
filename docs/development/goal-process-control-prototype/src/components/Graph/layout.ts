// Hand-placed layered layout: node positions fed to react-flow. Production computes them with a
// layered DAG layout (e.g. dagre/elk) over the goal graph snapshot.

import type { EdgeKind } from '../../types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Three columns (x = 40 / 360 / 700), rows every 170px — work cards are ~104px tall with the metric strip.
export const POS: Record<string, Box> = {
  G: { x: 360, y: 0, w: 240, h: 70 },
  P1: { x: 40, y: 170, w: 230, h: 70 },
  W1: { x: 360, y: 170, w: 260, h: 104 },
  W5: { x: 700, y: 170, w: 260, h: 104 },
  F1: { x: 40, y: 340, w: 240, h: 70 },
  F2: { x: 360, y: 340, w: 240, h: 70 },
  F5: { x: 700, y: 340, w: 240, h: 70 },
  W6: { x: 40, y: 510, w: 260, h: 104 },
  W2: { x: 360, y: 510, w: 260, h: 104 },
  D0: { x: 700, y: 510, w: 250, h: 70 },
  F6: { x: 40, y: 680, w: 240, h: 70 },
  D1: { x: 360, y: 680, w: 250, h: 70 },
  W3: { x: 700, y: 680, w: 260, h: 104 },
  F3: { x: 360, y: 850, w: 240, h: 70 },
  F4: { x: 700, y: 850, w: 240, h: 70 },
  W4: { x: 700, y: 1020, w: 260, h: 104 },
};

export const VIEW_W = 1000;
