import { useCallback, useEffect } from 'react';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { inboxKeys } from '@/libs/swr/keys';
import { notificationService } from '@/services/notification';

export const PAGE_SIZE = 20;

export interface NotificationListHandle {
  /** Optimistically empty the list (mark all read / archive all). */
  optimisticClear: () => void;
  /** Optimistically drop one item (mark as read / archive). */
  optimisticRemove: (id: string) => void;
  refresh: () => void;
}

interface UseNotificationListOptions {
  category?: string;
  /** Filter by read state; omit for the combined "all" view. */
  isRead?: boolean;
  /**
   * Registers the list's bound mutate operations with the caller. The global
   * filter-form `mutate` cannot reach this list: SWR's key-filter mutate
   * explicitly skips `$inf$` (useSWRInfinite) cache keys, so actions in the
   * modal must go through the hook's own `mutate`. The optimistic operations
   * update the cache without revalidating; callers roll back a failed action
   * by calling `refresh` (server state is the source of truth).
   */
  registerHandle: (handle: NotificationListHandle) => void;
}

export const useNotificationList = ({
  category,
  isRead,
  registerHandle,
}: UseNotificationListOptions) => {
  const workspaceId = useActiveWorkspaceId();

  const getKey = useCallback(
    (_pageIndex: number, previousPageData: any[] | null) => {
      if (previousPageData && previousPageData.length < PAGE_SIZE) return null;

      const lastItem = previousPageData?.at(-1);
      return inboxKeys.notifications(workspaceId, lastItem?.id, category, isRead);
    },
    [category, isRead, workspaceId],
  );

  const swr = useSWRInfinite(getKey, async ([, , cursor, filterCategory, filterIsRead]) => {
    return notificationService.list({
      category: filterCategory as string | undefined,
      cursor: cursor as string | undefined,
      isRead: filterIsRead as boolean | undefined,
      limit: PAGE_SIZE,
    });
  });

  const { mutate } = swr;
  useEffect(() => {
    registerHandle({
      optimisticClear: () => void mutate([], { revalidate: false }),
      optimisticRemove: (id) =>
        void mutate(
          (pages?: any[][]) => pages?.map((page) => page.filter((item) => item.id !== id)),
          { revalidate: false },
        ),
      refresh: () => void mutate(),
    });
  }, [mutate, registerHandle]);

  return swr;
};
