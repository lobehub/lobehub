export const MIN_PANE_WIDTH = 160;
export const DIVIDER_WIDTH = 9;

export const paneTrackWidth = (rootWidth: number, paneCount: number) =>
  rootWidth - (paneCount - 1) * DIVIDER_WIDTH;

/**
 * New flex values after dragging the divider that sits after `dividerIndex`.
 *
 * A divider only ever moves the two panes it sits between: their combined flex
 * is the budget, so every other pane keeps the width it had. Returns undefined
 * when the pair has no room left to honour MIN_PANE_WIDTH on both sides.
 */
export const resizePanes = (
  flex: number[],
  dividerIndex: number,
  deltaPx: number,
  trackWidth: number,
): number[] | undefined => {
  const total = flex.reduce((sum, value) => sum + value, 0);
  if (trackWidth <= 0 || total <= 0) return;

  const pairFlex = flex[dividerIndex] + flex[dividerIndex + 1];
  const minFlex = (MIN_PANE_WIDTH / trackWidth) * total;
  if (pairFlex < minFlex * 2) return;

  const dragged = flex[dividerIndex] + (deltaPx / trackWidth) * total;
  const next = Math.min(Math.max(dragged, minFlex), pairFlex - minFlex);

  return flex.map((value, index) => {
    if (index === dividerIndex) return next;
    if (index === dividerIndex + 1) return pairFlex - next;
    return value;
  });
};
