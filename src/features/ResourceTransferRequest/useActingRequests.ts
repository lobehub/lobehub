import { useCallback, useState } from 'react';

interface ShouldEndActingAfterRefreshOptions {
  actionSucceeded: boolean;
  refreshedRequests: { id: string }[] | undefined;
  requestId: string;
}

/**
 * A resolved request must stay locked until revalidation confirms that its
 * stale card is gone. Failed actions can be retried; failed or stale refreshes
 * after a successful action must not re-enable a duplicate submission.
 */
export const shouldEndActingAfterRefresh = ({
  actionSucceeded,
  refreshedRequests,
  requestId,
}: ShouldEndActingAfterRefreshOptions) =>
  !actionSucceeded || refreshedRequests?.every((request) => request.id !== requestId) === true;

/**
 * Per-request in-flight tracking for the transfer inbox. With several pending
 * cards, a scalar "acting id" would be overwritten by a second card's action —
 * re-enabling the first card mid-flight (duplicate submits) and letting
 * whichever action finishes first clear the other card's spinner. Each card
 * must stay marked acting until ITS OWN action settles.
 */
export const useActingRequests = () => {
  const [actingIds, setActingIds] = useState<Record<string, boolean>>({});

  const beginActing = useCallback((requestId: string) => {
    setActingIds((prev) => ({ ...prev, [requestId]: true }));
  }, []);

  const endActing = useCallback((requestId: string) => {
    setActingIds((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
  }, []);

  const isActing = useCallback((requestId: string) => !!actingIds[requestId], [actingIds]);

  return { beginActing, endActing, isActing };
};
