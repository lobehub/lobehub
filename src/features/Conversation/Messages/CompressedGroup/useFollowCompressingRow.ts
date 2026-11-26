import { useEffect } from 'react';

interface ScrollState {
  atBottom: boolean;
  autoScrollDetached: boolean;
  scrollToBottom: (smooth?: boolean) => void;
}

/**
 * The compressing row appears as the last row of the list, below the fold and
 * under the chat input. A reader following the conversation at the bottom
 * should see it, as with any new message, so scroll it into view once; a reader
 * who scrolled up keeps their place.
 */
export const useFollowCompressingRow = (active: boolean, getScrollState: () => ScrollState) => {
  useEffect(() => {
    if (!active) return;

    const { atBottom, autoScrollDetached, scrollToBottom } = getScrollState();
    if (!atBottom || autoScrollDetached) return;

    // Wait for the row to be laid out, or the scroll stops short of it.
    const frame = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frame);
  }, [active, getScrollState]);
};
