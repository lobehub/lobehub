import { describe, expect, it } from 'vitest';

import {
  ACTIVE_TAB_MIN_WIDTH,
  allocateTabWidths,
  MAX_TAB_WIDTH,
  MIN_TAB_WIDTH,
  OVERFLOW_CONTROL_WIDTH,
  PINNED_DIVIDER_MARGIN,
  PINNED_DIVIDER_WIDTH,
  PINNED_TAB_WIDTH,
  resolvePlacements,
  resolveTabInset,
  resolveTabTier,
  TAB_GAP,
  TAB_ICON_SIZE,
  TAB_INLINE_INSET,
} from './tabLayout';

const totalWidth = (widths: number[]) =>
  widths.reduce((sum, width) => sum + width, 0) + widths.length * TAB_GAP;

describe('resolveTabTier', () => {
  it.each([
    [200, 'full'],
    [130, 'full'],
    [129, 'compact'],
    [96, 'compact'],
    [95, 'narrow'],
    [58, 'narrow'],
    [57, 'icon'],
    [MIN_TAB_WIDTH, 'icon'],
  ])('maps %ipx to %s', (width, tier) => {
    expect(resolveTabTier(width)).toBe(tier);
  });
});

describe('resolveTabInset', () => {
  it('leads the title from a fixed inset while a title is still shown', () => {
    expect(resolveTabInset(MAX_TAB_WIDTH)).toBe(TAB_INLINE_INSET);
    expect(resolveTabInset(58)).toBe(TAB_INLINE_INSET);
  });

  it('centres the avatar once it is the only content left', () => {
    expect(resolveTabInset(57)).toBe((57 - TAB_ICON_SIZE) / 2);
    expect(resolveTabInset(MIN_TAB_WIDTH)).toBe((MIN_TAB_WIDTH - TAB_ICON_SIZE) / 2);
  });

  // Pinning sends a tab across the whole strip while it shrinks by 168px, so it is the one
  // width change where a sprung inset would read as the avatar drifting inside its own tab.
  // The pinned width is chosen to land back on the inset the tab already had.
  it('resolves a pinned pill to the inset it started from', () => {
    expect(resolveTabInset(PINNED_TAB_WIDTH)).toBe(TAB_INLINE_INSET);
  });
});

describe('allocateTabWidths', () => {
  it('returns nothing for an empty strip', () => {
    expect(allocateTabWidths({ activeIndex: -1, count: 0, usableWidth: 800 })).toEqual({
      hiddenCount: 0,
      visibleIndices: [],
      widths: [],
    });
  });

  it('caps a lone tab at the maximum width', () => {
    const { widths, hiddenCount } = allocateTabWidths({
      activeIndex: 0,
      count: 1,
      usableWidth: 900,
    });

    expect(widths).toEqual([MAX_TAB_WIDTH]);
    expect(hiddenCount).toBe(0);
  });

  it('splits evenly while every tab still clears the active floor', () => {
    const { widths, hiddenCount } = allocateTabWidths({
      activeIndex: 1,
      count: 3,
      usableWidth: 900,
    });

    expect(widths).toEqual([MAX_TAB_WIDTH, MAX_TAB_WIDTH, MAX_TAB_WIDTH]);
    expect(hiddenCount).toBe(0);
  });

  it('holds the active tab at its floor once the even split drops below it', () => {
    const { widths, visibleIndices, hiddenCount } = allocateTabWidths({
      activeIndex: 2,
      count: 8,
      usableWidth: 800,
    });

    expect(hiddenCount).toBe(0);
    expect(visibleIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(widths[2]).toBe(ACTIVE_TAB_MIN_WIDTH);
    expect(widths.filter((_, index) => index !== 2)).toSatisfy((rest: number[]) =>
      rest.every((width) => width < ACTIVE_TAB_MIN_WIDTH && width >= MIN_TAB_WIDTH),
    );
    expect(totalWidth(widths)).toBeLessThanOrEqual(800);
  });

  it('never shrinks a tab below the minimum, pushing the remainder into overflow', () => {
    const { widths, hiddenCount } = allocateTabWidths({
      activeIndex: 0,
      count: 30,
      usableWidth: 600,
    });

    expect(hiddenCount).toBeGreaterThan(0);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(MIN_TAB_WIDTH);
    expect(totalWidth(widths)).toBeLessThanOrEqual(600 - OVERFLOW_CONTROL_WIDTH);
  });

  it('keeps the active tab on screen when it sits past the overflow cut', () => {
    const { visibleIndices, widths } = allocateTabWidths({
      activeIndex: 25,
      count: 30,
      usableWidth: 600,
    });

    expect(visibleIndices).toContain(25);
    expect(visibleIndices.at(-1)).toBe(25);
    expect(widths.at(-1)).toBe(ACTIVE_TAB_MIN_WIDTH);
  });

  it('reserves room for the overflow control itself', () => {
    const usableWidth = 500;
    const { widths, hiddenCount } = allocateTabWidths({
      activeIndex: 0,
      count: 20,
      usableWidth,
    });

    expect(hiddenCount).toBeGreaterThan(0);
    expect(totalWidth(widths) + OVERFLOW_CONTROL_WIDTH).toBeLessThanOrEqual(usableWidth);
  });

  it('still renders one tab when the strip is narrower than a single tab', () => {
    const { widths, visibleIndices, hiddenCount } = allocateTabWidths({
      activeIndex: 3,
      count: 6,
      usableWidth: 20,
    });

    expect(widths).toHaveLength(1);
    expect(visibleIndices).toEqual([3]);
    expect(hiddenCount).toBe(5);
  });

  it('falls back to an even split when no tab is active', () => {
    const { widths } = allocateTabWidths({ activeIndex: -1, count: 6, usableWidth: 600 });

    expect(widths.every((width) => Math.abs(width - widths[0]) <= 1)).toBe(true);
  });

  // An active pinned tab leaves the flow list with no active index. Callers index straight
  // into the flow list with what comes back, so a lone flow tab must still resolve to a real
  // index — including before the strip is measured, when usableWidth is still 0.
  it('shows the lone flow tab when the active tab is pinned out of the list', () => {
    expect(allocateTabWidths({ activeIndex: -1, count: 1, usableWidth: 0 })).toEqual({
      hiddenCount: 0,
      visibleIndices: [0],
      widths: [MIN_TAB_WIDTH],
    });
  });

  it('never emits an index outside the flow list', () => {
    const offenders: string[] = [];

    for (const count of [1, 2, 3, 8, 30])
      for (const usableWidth of [0, 20, 29, 42, 76, 120, 600, 900])
        for (const activeIndex of [-1, 0, count - 1]) {
          const { visibleIndices, widths } = allocateTabWidths({ activeIndex, count, usableWidth });
          const invalid = visibleIndices.some((index) => index < 0 || index >= count);

          if (invalid || visibleIndices.length !== widths.length)
            offenders.push(
              `count=${count} width=${usableWidth} active=${activeIndex} → [${visibleIndices}]`,
            );
        }

    expect(offenders).toEqual([]);
  });

  // The trailing "+" button sits right after the last tab, so any width the split leaves
  // unspent moves it. Flooring alone leaves a different remainder per tab count, which
  // makes the button drift sideways on every added tab even when the strip is full.
  it('spends the whole budget once compressed, so the trailing control cannot drift', () => {
    const usableWidth = 900;
    const totals = Array.from({ length: 12 }, (_, index) => {
      const count = index + 8;
      const { widths, hiddenCount } = allocateTabWidths({ activeIndex: 0, count, usableWidth });
      return { hiddenCount, total: totalWidth(widths) };
    });

    for (const { total, hiddenCount } of totals) {
      const budget = hiddenCount > 0 ? usableWidth - OVERFLOW_CONTROL_WIDTH : usableWidth;
      expect(total).toBe(budget);
    }
    expect(new Set(totals.map((t) => t.total)).size).toBeLessThanOrEqual(2);
  });

  it('leaves the strip short of the budget only while tabs still fit at their maximum', () => {
    const { widths } = allocateTabWidths({ activeIndex: 0, count: 2, usableWidth: 900 });

    expect(widths).toEqual([MAX_TAB_WIDTH, MAX_TAB_WIDTH]);
    expect(totalWidth(widths)).toBeLessThan(900);
  });
});

describe('resolvePlacements', () => {
  it('returns nothing for an empty strip', () => {
    expect(
      resolvePlacements({ flowIds: [], pinnedIds: [], visibleIndices: [], widths: [] }),
    ).toEqual({ dividerX: PINNED_DIVIDER_MARGIN, placements: [], total: 0 });
  });

  it('lays flowing tabs out end to end with one gap between them', () => {
    const { placements, total } = resolvePlacements({
      flowIds: ['a', 'b', 'c'],
      pinnedIds: [],
      visibleIndices: [0, 1, 2],
      widths: [120, 80, 60],
    });

    expect(placements).toEqual([
      { id: 'a', pinned: false, width: 120, x: 0 },
      { id: 'b', pinned: false, width: 80, x: 122 },
      { id: 'c', pinned: false, width: 60, x: 204 },
    ]);
    // Trailing gap excluded: the strip ends at the last tab's right edge, and the
    // container's own flex gap supplies the space before the "+".
    expect(total).toBe(264);
  });

  it('leads with the pinned run and clears the divider before the flowing tabs', () => {
    const { dividerX, placements, total } = resolvePlacements({
      flowIds: ['c'],
      pinnedIds: ['a', 'b'],
      visibleIndices: [0],
      widths: [100],
    });

    const runEnd = 2 * (PINNED_TAB_WIDTH + TAB_GAP);

    expect(placements).toEqual([
      { id: 'a', pinned: true, width: PINNED_TAB_WIDTH, x: 0 },
      { id: 'b', pinned: true, width: PINNED_TAB_WIDTH, x: PINNED_TAB_WIDTH + TAB_GAP },
      { id: 'c', pinned: false, width: 100, x: runEnd + PINNED_DIVIDER_WIDTH },
    ]);
    expect(dividerX).toBe(runEnd + PINNED_DIVIDER_MARGIN);
    expect(total).toBe(runEnd + PINNED_DIVIDER_WIDTH + 100);
  });

  it('reserves no divider room when nothing is pinned', () => {
    const { placements } = resolvePlacements({
      flowIds: ['a'],
      pinnedIds: [],
      visibleIndices: [0],
      widths: [100],
    });

    expect(placements[0].x).toBe(0);
  });

  // The width split can promote a tab past the visible cut, so `visibleIndices` is not
  // always 0..n — placements must follow it rather than the flow order.
  it('follows the visible indices when the active tab is held past the cut', () => {
    const { placements } = resolvePlacements({
      flowIds: ['a', 'b', 'c', 'd'],
      pinnedIds: [],
      visibleIndices: [0, 3],
      widths: [40, 150],
    });

    expect(placements.map((placement) => placement.id)).toEqual(['a', 'd']);
    expect(placements[1].x).toBe(42);
  });

  it('skips an index that no longer resolves to a tab', () => {
    const { placements, total } = resolvePlacements({
      flowIds: ['a'],
      pinnedIds: [],
      visibleIndices: [0, 1],
      widths: [100, 100],
    });

    expect(placements).toEqual([{ id: 'a', pinned: false, width: 100, x: 0 }]);
    expect(total).toBe(100);
  });
});
