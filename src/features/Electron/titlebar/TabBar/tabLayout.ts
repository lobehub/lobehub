export const MAX_TAB_WIDTH = 200;
export const MIN_TAB_WIDTH = 40;
export const ACTIVE_TAB_MIN_WIDTH = 150;
export const PINNED_TAB_WIDTH = 34;
export const TAB_GAP = 2;
export const OVERFLOW_CONTROL_WIDTH = 34;

export type TabTier = 'compact' | 'full' | 'icon' | 'narrow';

export interface TabLayoutInput {
  activeIndex: number;
  count: number;
  usableWidth: number;
}

export interface TabLayoutResult {
  hiddenCount: number;
  /** Indices into the original tab list, in render order. */
  visibleIndices: number[];
  /** Width for each entry of `visibleIndices`. */
  widths: number[];
}

export const resolveTabTier = (width: number): TabTier => {
  if (width >= 130) return 'full';
  if (width >= 96) return 'compact';
  if (width >= 58) return 'narrow';
  return 'icon';
};

const clampWidth = (width: number): number =>
  Math.max(MIN_TAB_WIDTH, Math.min(MAX_TAB_WIDTH, Math.floor(width)));

interface Attempt {
  indices: number[];
  total: number;
  widths: number[];
}

const attemptLayout = (
  visibleCount: number,
  budget: number,
  count: number,
  activeIndex: number,
): Attempt => {
  const indices = Array.from({ length: visibleCount }, (_, index) => index);

  // The active tab must stay on screen; when it falls past the cut, it takes the last
  // visible slot instead of disappearing into the overflow list.
  if (activeIndex >= visibleCount && activeIndex < count) indices[visibleCount - 1] = activeIndex;

  const activePosition = indices.indexOf(activeIndex);
  const gaps = visibleCount * TAB_GAP;
  const even = clampWidth((budget - gaps) / visibleCount);

  const activeHeldAtFloor = visibleCount > 1 && activePosition >= 0 && even < ACTIVE_TAB_MIN_WIDTH;

  const widths = activeHeldAtFloor
    ? indices.map((_, position) =>
        position === activePosition
          ? ACTIVE_TAB_MIN_WIDTH
          : clampWidth((budget - ACTIVE_TAB_MIN_WIDTH - gaps) / (visibleCount - 1)),
      )
    : indices.map(() => even);

  const sum = () => widths.reduce((acc, width) => acc + width, 0) + gaps;

  // Hand the flooring remainder back out, one pixel at a time. Without this the strip
  // stops a few pixels short of its budget and by a different amount for each tab count,
  // so the trailing "+" button drifts sideways every time a tab is added — even once the
  // strip is visually full and nothing should move any more.
  if (sum() <= budget) {
    let remainder = budget - sum();
    while (remainder > 0) {
      const before = remainder;
      for (let index = 0; index < widths.length && remainder > 0; index += 1) {
        // The active tab's floor is a fixed, predictable number — it does not absorb
        // leftover pixels; the tabs sharing the remaining space do.
        if (widths[index] >= MAX_TAB_WIDTH || (activeHeldAtFloor && index === activePosition))
          continue;
        widths[index] += 1;
        remainder -= 1;
      }
      if (remainder === before) break;
    }
  }

  return { indices, total: sum(), widths };
};

/**
 * Splits the strip among tabs: everyone shrinks toward MIN_TAB_WIDTH, except the active
 * tab which holds ACTIVE_TAB_MIN_WIDTH outside the split so the current page keeps a
 * readable title at any density. Tabs that no longer fit are reported as hiddenCount for
 * the overflow control, whose own width is reserved before the split.
 */
export const allocateTabWidths = ({
  activeIndex,
  count,
  usableWidth,
}: TabLayoutInput): TabLayoutResult => {
  if (count <= 0) return { hiddenCount: 0, visibleIndices: [], widths: [] };

  const full = attemptLayout(count, usableWidth, count, activeIndex);
  if (full.total <= usableWidth) {
    return { hiddenCount: 0, visibleIndices: full.indices, widths: full.widths };
  }

  const budget = Math.max(MIN_TAB_WIDTH + TAB_GAP, usableWidth - OVERFLOW_CONTROL_WIDTH);
  // Overflow implies at least one hidden tab, hence the `count - 1` ceiling — but a single tab
  // is shown at any width, so the floor of 1 wins over it.
  const start = Math.max(1, Math.min(count - 1, Math.floor(budget / (MIN_TAB_WIDTH + TAB_GAP))));

  for (let visibleCount = start; visibleCount > 1; visibleCount -= 1) {
    const attempt = attemptLayout(visibleCount, budget, count, activeIndex);
    if (attempt.total <= budget) {
      return {
        hiddenCount: count - visibleCount,
        visibleIndices: attempt.indices,
        widths: attempt.widths,
      };
    }
  }

  const last = attemptLayout(1, budget, count, activeIndex);
  return { hiddenCount: count - 1, visibleIndices: last.indices, widths: last.widths };
};
