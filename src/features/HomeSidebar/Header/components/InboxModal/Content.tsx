'use client';

import type { NotificationMetadata } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BellOffIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { VListHandle } from 'virtua';
import { VList } from 'virtua';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { PENDING_TRANSFERS_SWR_KEY, TransferRequestItem } from '@/features/ResourceTransferRequest';
import { useClientDataSWR } from '@/libs/swr';
import type { PendingTransferRequest } from '@/services/resourceTransferRequest';
import { resourceTransferRequestService } from '@/services/resourceTransferRequest';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import NotificationItem from './NotificationItem';
import type { NotificationListHandle } from './useNotificationList';
import { PAGE_SIZE, useNotificationList } from './useNotificationList';

const styles = createStaticStyles(({ css }) => ({
  item: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

interface ContentProps {
  category?: string;
  /** Read-state filter; `undefined` renders the combined "all" view. */
  isRead?: boolean;
  onArchive: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  /**
   * Refreshes the surrounding inbox chrome (navigation counts, unread badge)
   * after a transfer action that has no loaded notification row to mark read.
   */
  onRefreshInbox: () => void;
  /** See {@link useNotificationList} for why the list handle is registered. */
  registerHandle: (handle: NotificationListHandle) => void;
}

const getLinkedRequestId = (item: { metadata?: NotificationMetadata | null }) =>
  item.metadata?.transfer?.requestId;

const Content = memo<ContentProps>(
  ({ category, isRead, onMarkAsRead, onArchive, onRefreshInbox, registerHandle }) => {
    const { t } = useTranslation('notification');
    const virtuaRef = useRef<VListHandle>(null);
    const workspaceId = useActiveWorkspaceId();
    const currentUserId = useUserStore(userProfileSelectors.userId);

    const {
      data: pages,
      error,
      isLoading,
      isValidating,
      mutate,
      setSize,
    } = useNotificationList({ category, isRead, registerHandle });

    // Cross-resource transfer inbox: live pending requests rendered as
    // notification-style items pinned above the immutable stream. Driven by
    // `listMine` rather than the rows so resolved/expired/withdrawn requests
    // simply drop out — no stale action buttons to reconcile. The items render
    // only in the unread view of the "all" and "pending" filters, where
    // actionable work belongs — but the live list is fetched for EVERY filter,
    // because row suppression below must hold on all of them (a linked row
    // must never show alongside, or instead of, its live item).
    const showTransfers = isRead !== true && (!category || category === 'pending');
    const { data: transferRequests, mutate: mutateTransfers } = useClientDataSWR<
      PendingTransferRequest[]
    >(workspaceId ? [PENDING_TRANSFERS_SWR_KEY, workspaceId] : null, () =>
      resourceTransferRequestService.listMine(),
    );

    // Reset scroll position and pagination when filter changes
    useEffect(() => {
      setSize(1);
      virtuaRef.current?.scrollTo(0);
    }, [category, isRead, setSize]);

    const notifications = pages?.flat() ?? [];
    const hasMore = pages ? pages.at(-1)?.length === PAGE_SIZE : false;

    const liveRequests = (showTransfers && currentUserId && transferRequests) || [];
    // While a request is live its actionable item replaces the immutable
    // `agent_transfer_requested` row EVERYWHERE — the suppression set derives
    // from the unfiltered live list, not the render-gated one, so a read row
    // cannot resurface in the Read tab while its request still awaits action.
    // Once resolved the row reappears as the historical record.
    const liveRequestIds = new Set((transferRequests ?? []).map((request) => request.id));
    const visibleNotifications = notifications.filter((item) => {
      const requestId = getLinkedRequestId(item);
      return !requestId || !liveRequestIds.has(requestId);
    });

    const handleTransferSettled = useCallback(
      async (request: PendingTransferRequest, succeeded: boolean) => {
        // Re-read first so the resolved item leaves before the row resurfaces.
        const next = await mutateTransfers();
        // The server settles the linked row (marks it read) as part of the
        // state transition — here only the surrounding chrome refreshes so the
        // badge and the read list pick the settled state up. A terminal
        // FAILURE (expired / resolved by another client) also settles the row
        // server-side, so refresh whenever the request left the live list,
        // not only on success — otherwise the cached row resurfaces unread.
        const stillLive = !!next?.some((item) => item.id === request.id);
        if (succeeded || !stillLive) onRefreshInbox();
      },
      [mutateTransfers, onRefreshInbox],
    );

    // The VList renders `visibleNotifications`, so the bottom index must be
    // compared against the rendered count — measuring against the unfiltered
    // page length would stall pagination once suppressed rows accumulate.
    const visibleCount = visibleNotifications.length;
    const handleScroll = useCallback(() => {
      const ref = virtuaRef.current;
      if (!ref || !hasMore || isValidating || error) return;

      const bottomVisibleIndex = ref.findItemIndex(ref.scrollOffset + ref.viewportSize);
      if (bottomVisibleIndex + 5 > visibleCount) {
        setSize((prev) => prev + 1);
      }
    }, [error, hasMore, isValidating, visibleCount, setSize]);

    // When every loaded row is suppressed by a live request there is no VList
    // to scroll, so pagination would never advance — fetch the next page until
    // something renders or the stream ends.
    const allLoadedSuppressed = visibleCount === 0 && notifications.length > 0;
    useEffect(() => {
      if (allLoadedSuppressed && hasMore && !isValidating && !error) {
        setSize((prev) => prev + 1);
      }
    }, [allLoadedSuppressed, error, hasMore, isValidating, setSize]);

    if (isLoading) {
      return (
        <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
          <SkeletonList rows={5} />
        </Flexbox>
      );
    }

    if (error && notifications.length === 0) {
      return (
        <AsyncError
          error={error}
          retrying={isValidating}
          variant="page"
          onRetry={() => void mutate()}
        />
      );
    }

    const transferItems =
      currentUserId &&
      liveRequests.map((request) => (
        <Flexbox className={styles.item} key={request.id}>
          <TransferRequestItem
            currentUserId={currentUserId}
            request={request}
            onSettled={handleTransferSettled}
          />
        </Flexbox>
      ));

    if (visibleNotifications.length === 0) {
      return (
        <Flexbox height="100%">
          {transferItems}
          {liveRequests.length === 0 && (
            <Flexbox align="center" gap={12} justify="center" paddingBlock={48}>
              <Icon color={cssVar.colorTextQuaternary} icon={BellOffIcon} size={40} />
              <Text type="secondary">
                {t(
                  isRead === undefined
                    ? 'inbox.empty'
                    : isRead
                      ? 'inbox.emptyRead'
                      : 'inbox.emptyUnread',
                )}
              </Text>
            </Flexbox>
          )}
        </Flexbox>
      );
    }

    return (
      <Flexbox height="100%">
        {transferItems}
        <VList ref={virtuaRef} style={{ flex: 1 }} onScroll={handleScroll}>
          {visibleNotifications.map((item) => (
            <Flexbox className={styles.item} key={item.id}>
              <NotificationItem
                actionUrl={item.actionUrl}
                content={item.content}
                context={item.context}
                createdAt={item.createdAt}
                id={item.id}
                isRead={item.isRead}
                metadata={item.metadata}
                title={item.title}
                type={item.type}
                onArchive={onArchive}
                onMarkAsRead={onMarkAsRead}
              />
            </Flexbox>
          ))}
          {error ? (
            <AsyncError
              error={error}
              retrying={isValidating}
              variant="inline"
              onRetry={() => void mutate()}
            />
          ) : isValidating ? (
            <Flexbox padding="4px 8px">
              <SkeletonList rows={2} />
            </Flexbox>
          ) : null}
        </VList>
      </Flexbox>
    );
  },
);

Content.displayName = 'InboxNotificationList';

export default Content;
