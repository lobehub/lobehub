import { describe, expect, it } from 'vitest';

import { DIVIDER_WIDTH, paneTrackWidth, resizePanes } from './paneLayout';

const rounded = (flex: number[] | undefined) =>
  flex?.map((value) => Math.round(value * 1000) / 1000);

describe('paneTrackWidth', () => {
  it('excludes the dividers, so flex maps onto the space panes actually get', () => {
    expect(paneTrackWidth(1000, 3)).toBe(1000 - 2 * DIVIDER_WIDTH);
    expect(paneTrackWidth(1000, 1)).toBe(1000);
  });
});

describe('resizePanes', () => {
  it('moves flex from one pane of the pair to the other', () => {
    expect(rounded(resizePanes([1, 1], 0, 200, 1000))).toEqual([1.4, 0.6]);
  });

  it('leaves panes outside the dragged pair untouched', () => {
    expect(rounded(resizePanes([1, 1, 1], 1, 100, 1000))).toEqual([1, 1.3, 0.7]);
  });

  it('clamps at MIN_PANE_WIDTH instead of collapsing the neighbour', () => {
    // 1000px track, total flex 2 → the 160px floor is 0.32 flex.
    expect(rounded(resizePanes([1, 1], 0, 100_000, 1000))).toEqual([1.68, 0.32]);
    expect(rounded(resizePanes([1, 1], 0, -100_000, 1000))).toEqual([0.32, 1.68]);
  });

  it('scales the floor with the pane count, since flex is relative to the total', () => {
    // 3 panes, total flex 3 → the same 160px floor is 0.48 flex.
    expect(rounded(resizePanes([1, 1, 1], 1, 100_000, 1000))).toEqual([1, 1.52, 0.48]);
  });

  it('refuses the drag when the pair cannot fit two minimum-width panes', () => {
    expect(resizePanes([1, 1], 0, 10, 300)).toBeUndefined();
  });

  it('refuses the drag before layout has a measurable width', () => {
    expect(resizePanes([1, 1], 0, 10, 0)).toBeUndefined();
  });
});
