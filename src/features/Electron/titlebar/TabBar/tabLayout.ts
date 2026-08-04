export const MAX_TAB_WIDTH = 200;
export const MIN_TAB_WIDTH = 40;
export const ACTIVE_TAB_MIN_WIDTH = 150;
export const TAB_ICON_SIZE = 16;
// Where the avatar sits while a title shares the tab with it.
export const TAB_INLINE_INSET = 8;
// Sized so that `resolveTabInset` returns TAB_INLINE_INSET for it: a pinned pill centres
// the avatar on the inset it already had, so pinning — the longest journey any tab makes —
// moves the avatar not at all relative to its own tab.
export const PINNED_TAB_WIDTH = TAB_ICON_SIZE + TAB_INLINE_INSET * 2;
export const TAB_GAP = 2;
export const OVERFLOW_CONTROL_WIDTH = 34;
export const PINNED_DIVIDER_MARGIN = 6;
export const PINNED_DIVIDER_WIDTH = PINNED_DIVIDER_MARGIN * 2 + 1;

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

// Below the icon tier the avatar is the only content left, so it takes the middle; above
// it, it leads the title from a fixed inset. The two rules disagree at the boundary — that
// is inherent, since centring grows with width while leading does not — so the caller must
// spring this value rather than apply it outright. Applying it outright is also what the
// stylesheet used to do, one `tier` flip ahead of the width it was computed for.
export const resolveTabInset = (width: number): number =>
  resolveTabTier(width) === 'icon' ? (width - TAB_ICON_SIZE) / 2 : TAB_INLINE_INSET;

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

export interface TabPlacement {
  id: string;
  pinned: boolean;
  width: number;
  x: number;
}

export interface TabPlacementInput {
  /** Ids of the unpinned tabs, in store order. */
  flowIds: string[];
  /** Ids of the pinned tabs, in store order — they always lead the strip. */
  pinnedIds: string[];
  visibleIndices: number[];
  widths: number[];
}

export interface TabPlacementResult {
  dividerX: number;
  placements: TabPlacement[];
  total: number;
}

/**
 * Turns the width allocation into absolute offsets. Tabs are positioned rather than laid
 * out by flex because pinning reorders the strip, and a flex reorder can only teleport:
 * an explicit x is what lets the moved tab spring across to its new slot.
 *
 * Offsets are derived from the target widths, not the animated ones. Same-parameter
 * springs superpose, so a tab springing its own x traces the identical path as summing
 * the neighbours' springing widths would — no per-frame layout pass needed.
 */
export const resolvePlacements = ({
  flowIds,
  pinnedIds,
  visibleIndices,
  widths,
}: TabPlacementInput): TabPlacementResult => {
  const placements: TabPlacement[] = [];
  let x = 0;

  for (const id of pinnedIds) {
    placements.push({ id, pinned: true, width: PINNED_TAB_WIDTH, x });
    x += PINNED_TAB_WIDTH + TAB_GAP;
  }

  const dividerX = x + PINNED_DIVIDER_MARGIN;
  if (pinnedIds.length > 0) x += PINNED_DIVIDER_WIDTH;

  visibleIndices.forEach((index, position) => {
    const id = flowIds[index];
    if (id === undefined) return;

    const width = widths[position];
    placements.push({ id, pinned: false, width, x });
    x += width + TAB_GAP;
  });

  return { dividerX, placements, total: Math.max(0, x - TAB_GAP) };
};
