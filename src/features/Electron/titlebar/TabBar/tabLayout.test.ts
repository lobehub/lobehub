import { describe, expect, it } from 'vitest';

import {
  ACTIVE_TAB_MIN_WIDTH,
  allocateTabWidths,
  MAX_TAB_WIDTH,
  MIN_TAB_WIDTH,
  OVERFLOW_CONTROL_WIDTH,
  resolveTabTier,
  TAB_GAP,
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
