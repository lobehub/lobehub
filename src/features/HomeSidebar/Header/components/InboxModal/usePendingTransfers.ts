import { useHomeStore } from '@/store/home';
import { homeNotificationSelectors } from '@/store/home/selectors';

/**
 * The caller's live transfer requests (workspace only), from the
 * `pendingTransferRequests` replica. Restored cards render at once, but their
 * actions stay locked until this session's read confirms them — so a failed
 * read must stay visible with a Retry, or the locked buttons have no way out.
 */
export const usePendingTransfers = (enabled: boolean) => {
  const { error, isValidating, revalidate } = useHomeStore(
    (s) => s.useFetchPendingTransferRequests,
  )(enabled);
  const requests = useHomeStore(homeNotificationSelectors.pendingTransferRequests);
  const isConfirmed = useHomeStore(homeNotificationSelectors.isPendingTransferRequestsConfirmed);

  return {
    error,
    isConfirmed,
    isValidating,
    /** Rows on screen; `undefined` until hydrated or fetched. */
    requests,
    retry: revalidate,
  };
};
