import { describe, expect, it } from 'vitest';

import { getMarqueeDuration, shouldRevealOnPointerDown } from './utils';

describe('getMarqueeDuration', () => {
  it('scrolls both ways at 40px/s within the 40% of the loop left after the holds', () => {
    // 186px each way = 9.3s of scrolling, which is 40% of the loop.
    expect(getMarqueeDuration(186)).toBeCloseTo(23.25);
  });

  it('never drops below 3s for short overflows', () => {
    expect(getMarqueeDuration(4)).toBe(3);
  });
});

describe('shouldRevealOnPointerDown', () => {
  const base = { overflow: 186, pointerType: 'touch', reducedMotion: false };

  it('reveals on a touch tap when text overflows', () => {
    expect(shouldRevealOnPointerDown(base)).toBe(true);
  });

  it('leaves mouse and pen to the hover rule', () => {
    expect(shouldRevealOnPointerDown({ ...base, pointerType: 'mouse' })).toBe(false);
    expect(shouldRevealOnPointerDown({ ...base, pointerType: 'pen' })).toBe(false);
  });

  it('does nothing when the text fits', () => {
    expect(shouldRevealOnPointerDown({ ...base, overflow: 0 })).toBe(false);
  });

  it('does nothing under reduced motion', () => {
    expect(shouldRevealOnPointerDown({ ...base, reducedMotion: true })).toBe(false);
  });
});
