import { useCallback } from 'react';

interface ScrollState {
  atBottom: boolean;
  autoScrollDetached: boolean;
  scrollToBottom: (smooth?: boolean) => void;
}

interface RevealOnExpandParams {
  expanded: boolean;
  getScrollState: () => ScrollState;
  /** Only the last row grows below the fold; a mid-list group opens in view. */
  isLastRow: boolean;
  toggleExpanded: () => void;
}

/**
 * Opening the summary of the last row grows it under the chat input. A reader
 * at the bottom clicked it to read it, so follow it down, as the list does for
 * a new message; collapsing, or a reader who scrolled up, keeps the view.
 */
export const useRevealOnExpand = ({
  expanded,
  getScrollState,
  isLastRow,
  toggleExpanded,
}: RevealOnExpandParams) =>
  useCallback(() => {
    const { atBottom, autoScrollDetached } = getScrollState();
    const reveal = !expanded && isLastRow && atBottom && !autoScrollDetached;

    toggleExpanded();
    if (!reveal) return;

    // Two frames: React commits the summary, then virtua measures the taller row.
    requestAnimationFrame(() => requestAnimationFrame(() => getScrollState().scrollToBottom()));
  }, [expanded, getScrollState, isLastRow, toggleExpanded]);
