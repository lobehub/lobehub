import { describe, expect, it } from 'vitest';

import { revealCenter } from './revealNode';

const box = { height: 100, width: 200, x: 800, y: 100 };

describe('revealCenter', () => {
  it('leaves the viewport alone when the node is already visible', () => {
    expect(
      revealCenter(box, { x: 0, y: 0, zoom: 1 }, { height: 600, width: 1200 }),
    ).toBeUndefined();
  });

  it('centers on a node the opening panel pushed out of view', () => {
    expect(revealCenter(box, { x: 0, y: 0, zoom: 1 }, { height: 600, width: 700 })).toEqual({
      x: 900,
      y: 150,
    });
  });

  it('measures visibility at the current zoom', () => {
    expect(
      revealCenter(box, { x: 0, y: 0, zoom: 0.5 }, { height: 600, width: 700 }),
    ).toBeUndefined();
  });
});
