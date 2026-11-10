import { useCallback, useMemo } from 'react';

import { useHomeStore } from '@/store/home';
import { homeNotificationSelectors } from '@/store/home/selectors';

interface UseNotificationListOptions {
  category?: string;
  /** Filter by read state; omit for the combined "all" view. */
  isRead?: boolean;
}

/**
 * One inbox view of the notification stream, backed by the `inboxNotifications`
 * replica: it paints its last head page at once (even after a reload) while the
 * server confirms it in the background. Writes go through the home store's
 * notification actions, which update the replica and its storage.
 */
export const useNotificationList = ({ category, isRead }: UseNotificationListOptions) => {
  const view = useMemo(() => ({ category, isRead }), [category, isRead]);
  const {
    error: headError,
    isValidating: isHeadValidating,
    revalidate,
  } = useHomeStore((s) => s.useFetchInboxNotifications)(view);
  const feed = useHomeStore(homeNotificationSelectors.notificationFeed(view));
  const isConfirmed = useHomeStore(homeNotificationSelectors.isNotificationFeedConfirmed(view));

  const loadMore = useCallback(
    () => void useHomeStore.getState().loadMoreInboxNotifications(view),
    [view],
  );

  // A row read from another view stays in this view's copy until the next
  // refresh; the read-state filter keeps it on the side it now belongs to.
  const notifications = useMemo(
    () => feed?.items.filter((item) => isRead === undefined || item.isRead === isRead) ?? undefined,
    [feed?.items, isRead],
  );
  const loadMoreError = feed?.loadMoreError;

  const retry = useCallback(() => {
    if (feed && loadMoreError) loadMore();
    else void revalidate();
  }, [feed, loadMore, loadMoreError, revalidate]);

  return {
    /**
     * Any failure to surface: with rows on screen it renders as the inline
     * Retry row below them (a failed "load more" or a failed refresh), with
     * none it is the first-load failure.
     */
    error: feed ? (loadMoreError ?? headError) : headError,
    hasMore: !!feed?.hasMore,
    /** A failed first load with nothing persisted to fall back on. */
    headError: feed ? undefined : headError,
    /**
     * Whether the server answered this view in this session. A restored
     * snapshot may be empty or stale, so an empty list is "loading" until then.
     */
    isConfirmed,
    isHeadValidating,
    isLoadingMore: !!feed?.isLoadingMore,
    /** Rows on screen; `undefined` until hydrated or fetched. */
    notifications,
    loadMore,
    loadMoreError,
    retry,
  };
};
