import { describe, expect, it } from 'vitest';

import { clampPosition, VIEWPORT_MARGIN } from './dragPosition';

describe('clampPosition', () => {
  const size = { height: 200, width: 360 };
  const viewport = { height: 800, width: 1200 };

  it('keeps a position that already fits', () => {
    expect(clampPosition({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 });
  });

  it('pulls a box dragged past an edge back inside the viewport', () => {
    expect(clampPosition({ x: -50, y: -20 }, size, viewport)).toEqual({
      x: VIEWPORT_MARGIN,
      y: VIEWPORT_MARGIN,
    });
    expect(clampPosition({ x: 5000, y: 5000 }, size, viewport)).toEqual({
      x: viewport.width - size.width - VIEWPORT_MARGIN,
      y: viewport.height - size.height - VIEWPORT_MARGIN,
    });
  });

  it('pins to the top-left margin when the viewport is smaller than the box', () => {
    expect(clampPosition({ x: 40, y: 40 }, size, { height: 100, width: 200 })).toEqual({
      x: VIEWPORT_MARGIN,
      y: VIEWPORT_MARGIN,
    });
  });
});
