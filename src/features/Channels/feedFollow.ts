import { useLatest } from 'ahooks';
import { type RefObject, useCallback } from 'react';

/**
 * Keeps a scrolling feed on its foot while its content changes size after it rendered: a card that
 * settles its height after the first paint (charts, measured layouts), an image that loads, or the
 * viewport shrinking under a taller composer. `shouldFollow` is asked on every change, so a reader
 * who scrolled up is left where they are. Returns the cleanup.
 */
export const followFeedBottom = (feed: HTMLElement, shouldFollow: () => boolean) => {
  const resize = new ResizeObserver(() => {
    if (shouldFollow()) feed.scrollTop = feed.scrollHeight;
  });
  const observe = () => {
    resize.disconnect();
    resize.observe(feed);
    for (const child of feed.children) resize.observe(child);
  };
  observe();
  // The feed's direct children can be replaced (empty state, older-page controls).
  const mutation = new MutationObserver(observe);
  mutation.observe(feed, { childList: true });
  return () => {
    mutation.disconnect();
    resize.disconnect();
  };
};

/**
 * Callback ref for the feed's scroll container: fills `feedRef` and follows the feed's foot while
 * `shouldFollow` holds (see `followFeedBottom`).
 */
export const useFeedFollow = (
  feedRef: RefObject<HTMLDivElement | null>,
  shouldFollow: () => boolean,
) => {
  const follow = useLatest(shouldFollow);
  return useCallback(
    (node: HTMLDivElement | null) => {
      feedRef.current = node;
      if (!node) return;
      const stop = followFeedBottom(node, () => follow.current());
      return () => {
        stop();
        if (feedRef.current === node) feedRef.current = null;
      };
    },
    [feedRef, follow],
  );
};
