import { useHomeStore } from '@/store/home';
import { homeNotificationSelectors } from '@/store/home/selectors';

/**
 * The inbox sidebar counts, from the `inboxNavigationCounts` replica: a
 * reopened modal (even after a reload) paints the last counts at once while
 * the server confirms them. The latest fetch error is always reported — with
 * cached counts on screen it still drives the inline Retry and keeps the bulk
 * actions locked, since the counts may no longer be current.
 */
export const useNavigationCounts = () => {
  const { error, isValidating, revalidate } = useHomeStore(
    (s) => s.useFetchInboxNavigationCounts,
  )();
  const counts = useHomeStore(homeNotificationSelectors.navigationCounts);
  const isConfirmed = useHomeStore(homeNotificationSelectors.isNavigationCountsConfirmed);

  return {
    /** `undefined` until hydrated or fetched. */
    counts,
    error,
    /** Only a server answer may drop a category: a restored snapshot can be stale. */
    isConfirmed,
    isLoading: !counts && !error,
    isValidating,
    retry: revalidate,
  };
};
