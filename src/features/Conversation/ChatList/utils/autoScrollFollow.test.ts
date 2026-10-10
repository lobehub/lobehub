import { describe, expect, it } from 'vitest';

import { AT_BOTTOM_THRESHOLD } from '../components/AutoScroll/const';
import { AUTO_SCROLL_REATTACH_THRESHOLD, resolveAutoScrollDetached } from './autoScrollFollow';

describe('resolveAutoScrollDetached', () => {
  it('detaches when the user scrolls up while still inside the atBottom band', () => {
    // Regression: a short wheel-up (< AT_BOTTOM_THRESHOLD) used to keep
    // auto-scroll engaged, so the next streaming chunk snapped back down.
    const distanceToBottom = 100;
    expect(distanceToBottom).toBeLessThan(AT_BOTTOM_THRESHOLD);

    expect(
      resolveAutoScrollDetached({
        detached: false,
        distanceToBottom,
        hasActiveScrollInput: true,
        offset: 900,
        prevOffset: 1000,
      }),
    ).toBe(true);
  });

  it('stays attached when the offset is clamped up at the real bottom', () => {
    // Collapsing a block near the bottom shrinks the content and pulls the
    // offset up without the user leaving the bottom.
    expect(
      resolveAutoScrollDetached({
        detached: false,
        distanceToBottom: 0,
        hasActiveScrollInput: true,
        offset: 800,
        prevOffset: 1000,
      }),
    ).toBe(false);
  });

  it('detaches on a small upward user scroll inside the re-attach band', () => {
    expect(
      resolveAutoScrollDetached({
        detached: false,
        distanceToBottom: 20,
        hasActiveScrollInput: true,
        offset: 980,
        prevOffset: 1000,
      }),
    ).toBe(true);
  });

  it('re-attaches when the user scrolls down into the re-attach band', () => {
    expect(
      resolveAutoScrollDetached({
        detached: true,
        distanceToBottom: AUTO_SCROLL_REATTACH_THRESHOLD - 4,
        hasActiveScrollInput: true,
        offset: 1000,
        prevOffset: 900,
      }),
    ).toBe(false);
  });

  it('stays detached while the user scrolls down but has not reached the real bottom', () => {
    expect(
      resolveAutoScrollDetached({
        detached: true,
        distanceToBottom: AUTO_SCROLL_REATTACH_THRESHOLD + 50,
        hasActiveScrollInput: true,
        offset: 950,
        prevOffset: 900,
      }),
    ).toBe(true);
  });

  it('re-attaches once the viewport reaches the real bottom', () => {
    expect(
      resolveAutoScrollDetached({
        detached: true,
        distanceToBottom: 0,
        hasActiveScrollInput: false,
        offset: 1200,
        prevOffset: 900,
      }),
    ).toBe(false);
  });

  it('ignores upward offset changes without active scroll input', () => {
    expect(
      resolveAutoScrollDetached({
        detached: false,
        distanceToBottom: 120,
        hasActiveScrollInput: false,
        offset: 900,
        prevOffset: 1000,
      }),
    ).toBe(false);
  });

  it('keeps the state when there is no previous offset', () => {
    expect(
      resolveAutoScrollDetached({
        detached: true,
        distanceToBottom: 200,
        hasActiveScrollInput: true,
        offset: 900,
        prevOffset: null,
      }),
    ).toBe(true);
  });
});
