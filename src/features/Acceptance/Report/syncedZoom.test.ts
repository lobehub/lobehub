import { describe, expect, it } from 'vitest';

import {
  boundView,
  containedFrame,
  FIT_VIEW,
  fullFrame,
  MAX_SCALE,
  panView,
  sharedFrame,
  zoomViewAt,
} from './syncedZoom';

const box = fullFrame(400, 300);

describe('syncedZoom', () => {
  it('keeps the pointed pane point fixed while zooming', () => {
    const view = zoomViewAt(FIT_VIEW, 2, 100, 50, box);
    expect(view).toEqual({ scale: 2, x: -100, y: -50 });
    // The content point under (100, 50) before is still under it after.
    expect((100 - view.x) / view.scale).toBe(100);
    expect((50 - view.y) / view.scale).toBe(50);
  });

  it('clamps the scale between fit and the maximum', () => {
    expect(zoomViewAt(FIT_VIEW, 0.5, 10, 10, box)).toEqual(FIT_VIEW);
    expect(zoomViewAt(FIT_VIEW, 100, 0, 0, box).scale).toBe(MAX_SCALE);
  });

  it('returns to the fitted position when zooming back out', () => {
    const zoomed = zoomViewAt(FIT_VIEW, 3, 390, 290, box);
    expect(zoomViewAt(zoomed, 1, 10, 10, box)).toEqual(FIT_VIEW);
  });

  it('never pans the content off the pane', () => {
    const zoomed = { scale: 2, x: -100, y: -100 };
    expect(panView(zoomed, 500, 500, box)).toEqual({ scale: 2, x: 0, y: 0 });
    expect(panView(zoomed, -1000, -1000, box)).toEqual({ scale: 2, x: -400, y: -300 });
    expect(boundView({ scale: 1, x: -20, y: 5 }, box)).toEqual(FIT_VIEW);
  });

  it('stops a letterboxed picture at its own edges, not the box edges', () => {
    // A 1600×900 capture in an 800×800 box renders 800×450 with 175px bars.
    const frame = containedFrame(800, 800, 1600, 900);
    expect(frame.content).toEqual({ height: 450, width: 800, x: 0, y: 175 });
    expect(boundView(FIT_VIEW, frame)).toEqual(FIT_VIEW);

    // At 6× the picture spans 175·6 … 625·6; panning to the bottom-right may
    // only bring its bottom edge to the box's bottom, never past it.
    const corner = panView({ scale: 6, x: 0, y: 0 }, -1e5, -1e5, frame);
    expect(corner).toEqual({ scale: 6, x: 800 - 800 * 6, y: 800 - 625 * 6 });
    const top = panView({ scale: 6, x: 0, y: 0 }, 1e5, 1e5, frame);
    expect(top.y).toBe(-175 * 6);
  });

  it('keeps a picture still narrower than the box centred while zooming', () => {
    const frame = containedFrame(800, 800, 1600, 900);
    // At 1.5× the 450px-tall picture is 675px tall: centred, whatever the pointer.
    const view = zoomViewAt(FIT_VIEW, 1.5, 400, 0, frame);
    expect(view.y).toBe((800 - 675) / 2 - 175 * 1.5);
  });

  it('keeps both pictures in view when their aspect ratios differ', () => {
    const wide = containedFrame(800, 800, 1600, 900);
    const tall = containedFrame(800, 800, 900, 1600);
    const frame = sharedFrame(wide, tall);
    expect(frame.content).toEqual({ height: 450, width: 450, x: 175, y: 175 });

    // Every corner a 600% pan can reach still has both pictures under the whole pane.
    for (const [dx, dy] of [
      [1e5, 1e5],
      [-1e5, -1e5],
      [1e5, -1e5],
      [-1e5, 1e5],
    ]) {
      const view = panView({ scale: 6, x: -2000, y: -2000 }, dx, dy, frame);
      for (const { content } of [wide, tall]) {
        expect(view.x + content.x * 6).toBeLessThanOrEqual(0);
        expect(view.x + (content.x + content.width) * 6).toBeGreaterThanOrEqual(800);
        expect(view.y + content.y * 6).toBeLessThanOrEqual(0);
        expect(view.y + (content.y + content.height) * 6).toBeGreaterThanOrEqual(800);
      }
    }
  });
});
