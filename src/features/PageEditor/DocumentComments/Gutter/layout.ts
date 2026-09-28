export interface GutterLayoutEntry {
  /** Where the card wants to sit: the top of its anchored run, in gutter coordinates. */
  anchorTop: number;
  height: number;
  id: string;
  /** Tie-breaker for cards anchored on the same line: document order. */
  order: number;
}

export interface GutterLayoutOptions {
  /**
   * The card that must sit exactly level with its run. Neighbours yield to it
   * — above it they move up, below it they move down — instead of it being
   * pushed off its line by whatever happens to sit above.
   */
  activeId?: string | null;
  /** Vertical breathing room between stacked cards. */
  gap: number;
}

const byAnchor = (left: GutterLayoutEntry, right: GutterLayoutEntry) =>
  left.anchorTop - right.anchorTop || left.order - right.order;

/**
 * Stack comment cards down a gutter so none overlap.
 *
 * Every card starts level with its anchored run. Walking down the document,
 * a card that would overlap the one above it is pushed down to clear it, so
 * two comments on adjacent lines read as a stack rather than a pile. The
 * active card is the exception: it stays put and the stack is resolved
 * outwards from it, which is what makes "click a run, its card lines up"
 * hold even in a dense cluster. Cards above the active one are pushed up
 * as far as they need to go — past the top of the document if the cluster
 * is taller than the room above the run. `useGutterLayout` then makes that
 * room by extending the document upwards, so those cards stay reachable.
 */
export const layoutGutterCards = (
  entries: readonly GutterLayoutEntry[],
  { activeId, gap }: GutterLayoutOptions,
): Map<string, number> => {
  const sorted = [...entries].sort(byAnchor);
  const tops = sorted.map(({ anchorTop }) => Math.max(0, anchorTop));

  const stackDown = (from: number) => {
    for (let index = from; index < sorted.length; index++) {
      const previous = index - 1;
      if (previous < 0) continue;
      const floor = tops[previous] + sorted[previous].height + gap;
      if (tops[index] < floor) tops[index] = floor;
    }
  };

  const activeIndex = activeId ? sorted.findIndex(({ id }) => id === activeId) : -1;
  if (activeIndex === -1) {
    stackDown(0);
  } else {
    // Above the active card, each neighbour rises just enough to clear the
    // one below it; its own anchor is an upper bound, never a floor.
    for (let index = activeIndex - 1; index >= 0; index--) {
      const ceiling = tops[index + 1] - gap - sorted[index].height;
      if (tops[index] > ceiling) tops[index] = ceiling;
    }
    stackDown(activeIndex + 1);
  }

  return new Map(sorted.map(({ id }, index) => [id, tops[index]]));
};

/**
 * How far the stack rises above the panel's clip box: cards above an active
 * card are pushed up as far as they must go, past the first line if the
 * cluster is taller than the room above the run. The pane cannot scroll
 * there, so the panel lets the reader pull the stack down by this much once
 * the pane is at its top (see `useGutterLayout`). Zero with no cards.
 */
export const gutterOverhangTop = ({
  clipTop,
  tops,
}: {
  /** Top of the panel's clip box, in the same coordinates as the card tops. */
  clipTop: number;
  tops: ReadonlyMap<string, number>;
}): number => {
  let min = Infinity;
  for (const top of tops.values()) min = Math.min(min, top);
  return min === Infinity ? 0 : Math.max(0, Math.ceil(clipTop - min));
};

export interface GutterOverflowInput {
  /** Bottom edge of the panel's clip box, relative to the pane's viewport top. */
  hostBottom: number;
  /** The pane's scrollable content height. */
  paneContentHeight: number;
  /** The pane's viewport height. */
  paneViewportHeight: number;
  /** Bottom edge of the lowest card, in the pane's content coordinates. */
  stackBottom: number;
}

/**
 * How far the stack hangs below what the pane can scroll to.
 *
 * Cards are stacked down from their runs, so a dense cluster near the end of
 * the document can extend below the last line of text, past the end of the
 * pane's scroll range. The panel lets the reader pull the stack up by this
 * much once the pane is at its end (see `useGutterLayout`).
 */
export const gutterOverhangBottom = ({
  hostBottom,
  paneContentHeight,
  paneViewportHeight,
  stackBottom,
}: GutterOverflowInput): number => {
  const maxScroll = Math.max(0, paneContentHeight - paneViewportHeight);
  const reachable = maxScroll + hostBottom;
  return Math.max(0, Math.ceil(stackBottom - reachable));
};
