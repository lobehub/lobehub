import { describe, expect, it } from 'vitest';

import { clampZoom, nextZoom, ZOOM_STEPS } from './rejectDraft';

describe('nextZoom', () => {
  it('steps one notch from a notch and stops at both ends', () => {
    expect(nextZoom(1, 1)).toBe(1.5);
    expect(nextZoom(1, -1)).toBe(0.75);
    expect(nextZoom(ZOOM_STEPS.at(-1)!, 1)).toBe(ZOOM_STEPS.at(-1));
    expect(nextZoom(ZOOM_STEPS[0], -1)).toBe(ZOOM_STEPS[0]);
  });

  it('lands on the next notch in that direction from between two notches (after a pinch)', () => {
    expect(nextZoom(1.23, 1)).toBe(1.5);
    expect(nextZoom(1.23, -1)).toBe(1);
    expect(nextZoom(2.7, 1)).toBe(3);
    expect(nextZoom(2.7, -1)).toBe(2);
  });
});

describe('clampZoom', () => {
  it('keeps a pinched value inside the range the buttons can reach', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_STEPS[0]);
    expect(clampZoom(9)).toBe(ZOOM_STEPS.at(-1));
    expect(clampZoom(1.7)).toBe(1.7);
  });
});
