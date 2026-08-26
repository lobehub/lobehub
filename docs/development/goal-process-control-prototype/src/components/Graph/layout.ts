// Hand-placed layered layout for the prototype. Production uses a layered DAG layout engine.

import type { EdgeKind } from '../../types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Columns: A x=40 w=220 · B x=300 w=280 · C x=620 w=300. Rows every ~104px.
export const POS: Record<string, Box> = {
  G: { x: 370, y: 24, w: 220, h: 48 },
  P1: { x: 40, y: 120, w: 220, h: 56 },
  W1: { x: 300, y: 120, w: 260, h: 56 },
  W5: { x: 620, y: 120, w: 300, h: 56 },
  F1: { x: 40, y: 220, w: 220, h: 52 },
  F2: { x: 300, y: 220, w: 200, h: 52 },
  F5: { x: 620, y: 220, w: 300, h: 52 },
  W6: { x: 40, y: 316, w: 220, h: 56 },
  W2: { x: 300, y: 316, w: 280, h: 84 },
  D0: { x: 620, y: 316, w: 300, h: 56 },
  F6: { x: 40, y: 444, w: 220, h: 52 },
  W3: { x: 620, y: 444, w: 300, h: 56 },
  D1: { x: 300, y: 444, w: 240, h: 56 },
  F4: { x: 620, y: 548, w: 240, h: 52 },
  F3: { x: 300, y: 548, w: 280, h: 52 },
  W4: { x: 620, y: 652, w: 300, h: 56 },
};

export const VIEW_W = 960;

const center = (p: Box) => ({ cx: p.x + p.w / 2, cy: p.y + p.h / 2 });

/** Curve between two boxes. `depends_on` and `produces` hug the right edge so they miss the rows between. */
export const edgePath = (a: string, b: string, kind: EdgeKind) => {
  if (kind === 'depends_on') [a, b] = [b, a];
  const from = POS[a];
  const to = POS[b];
  const fc = center(from);
  const tc = center(to);
  const hug = kind === 'depends_on' || (kind === 'produces' && to.y - (from.y + from.h) > 120);
  if (to.y >= from.y + from.h) {
    const x1 = hug ? from.x + from.w - 24 : fc.cx;
    const x2 = hug ? to.x + to.w - 24 : tc.cx;
    const y1 = from.y + from.h;
    const y2 = to.y;
    const my = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
  }
  if (from.y >= to.y + to.h) {
    // upward (e.g. finding supports problem)
    const x1 = fc.cx + 40;
    const x2 = tc.cx + 40;
    const y1 = from.y;
    const y2 = to.y + to.h;
    const my = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
  }
  const ltr = tc.cx > fc.cx;
  const x1 = ltr ? from.x + from.w : from.x;
  const x2 = ltr ? to.x : to.x + to.w;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${fc.cy} C ${mx} ${fc.cy}, ${mx} ${tc.cy}, ${x2} ${tc.cy}`;
};
