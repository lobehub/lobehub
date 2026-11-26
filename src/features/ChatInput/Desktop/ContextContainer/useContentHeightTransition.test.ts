import { describe, expect, it } from 'vitest';

import { createHeightMotionGate } from './useContentHeightTransition';

describe('createHeightMotionGate', () => {
  it('animates every resize shortly after the content changed', () => {
    const gate = createHeightMotionGate(0);
    gate.contentChanged(2000);

    // A removed card shrinks while it exits, then the row collapses once it is gone.
    expect(gate.shouldAnimate(2080)).toBe(true);
    expect(gate.shouldAnimate(2180)).toBe(true);
  });

  it('does not animate a restored draft that fills in right after mount', () => {
    const gate = createHeightMotionGate(1000);
    gate.contentChanged(1050);

    expect(gate.shouldAnimate(1066)).toBe(false);
  });

  it('does not animate resizes that are not near a content change', () => {
    const gate = createHeightMotionGate(0);
    expect(gate.shouldAnimate(2000)).toBe(false);

    gate.contentChanged(2000);
    expect(gate.shouldAnimate(5000)).toBe(false);
  });
});
