import { describe, expect, it } from 'vitest';

import { nextWidenBaseline } from './widenRemount';

describe('nextWidenBaseline', () => {
  it('measures the frame again once the container is clearly wider', () => {
    // Opened from the narrow chat portal, then shown as a full page.
    expect(nextWidenBaseline(368, 650)).toEqual({ baseline: 650, remount: true });
  });

  it('lets a narrowing container grow the frame on its own', () => {
    expect(nextWidenBaseline(650, 368)).toEqual({ baseline: 368, remount: false });
  });

  it('measures again after narrowing then widening back', () => {
    const narrowed = nextWidenBaseline(650, 400);
    expect(nextWidenBaseline(narrowed.baseline, 650)).toEqual({ baseline: 650, remount: true });
  });

  it('ignores sub-threshold jitter', () => {
    expect(nextWidenBaseline(650, 660)).toEqual({ baseline: 650, remount: false });
  });
});
