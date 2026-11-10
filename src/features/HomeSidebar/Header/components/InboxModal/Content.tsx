'use client';

import type { NotificationMetadata } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BellOffIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { VListHandle } from 'virtua';
import { VList } from 'virtua';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { TransferRequestItem } from '@/features/ResourceTransferRequest';
import type { PendingTransferRequest } from '@/services/resourceTransferRequest';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import NotificationItem from './NotificationItem';
import { useNotificationList } from './useNotificationList';
import { usePendingTransfers } from './usePendingTransfers';

const styles = stylex.create({
  item: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorFillSecondary,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

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
}

const getLinkedRequestId = (item: { metadata?: NotificationMetadata | null }) =>
  item.metadata?.transfer?.requestId;

const Content = memo<ContentProps>(
  ({ category, isRead, onMarkAsRead, onArchive, onRefreshInbox }) => {
    const { t } = useTranslation('notification');
    const virtuaRef = useRef<VListHandle>(null);
    const workspaceId = useActiveWorkspaceId();
    const currentUserId = useUserStore(userProfileSelectors.userId);

    const {
      error,
      hasMore,
      headError,
      isConfirmed: isFeedConfirmed,
      isHeadValidating,
      isLoadingMore,
      loadMore,
      loadMoreError,
      notifications: loadedNotifications,
      retry,
    } = useNotificationList({ category, isRead });

    // Cross-resource transfer inbox: live pending requests rendered as
    // notification-style items pinned above the immutable stream. Driven by
    // `listMine` rather than the rows so resolved/expired/withdrawn requests
    // simply drop out — no stale action buttons to reconcile. The items render
    // only in the unread view of the "all" and "pending" filters, where
    // actionable work belongs — but the live list is fetched for EVERY filter,
    // because row suppression below must hold on all of them (a linked row
    // must never show alongside, or instead of, its live item).
    const showTransfers = isRead !== true && (!category || category === 'pending');
    const {
      error: transfersError,
      isConfirmed: isTransfersConfirmed,
      isValidating: isTransfersValidating,
      requests: transferRequests,
      retry: retryTransfers,
    } = usePendingTransfers(!!workspaceId);

    // Each filter is its own replica entry; only the scroll position resets.
    useEffect(() => {
      virtuaRef.current?.scrollTo(0);
    }, [category, isRead]);

    const notifications = loadedNotifications ?? [];
    const isValidating = isLoadingMore || (!loadedNotifications && isHeadValidating);

    const liveRequests = (showTransfers && currentUserId && transferRequests) || [];
    // While a request is live its actionable item replaces the immutable
    // `agent_transfer_requested` row in every TAB — the suppression set
    // derives from the unfiltered live list, not the render-gated one, so a
    // read row cannot resurface in the Read tab while its request still
    // awaits action. Once resolved the row reappears as the historical
    // record. Suppression is scoped to the `pending` CATEGORY to mirror the
    // server's count reconciliation exactly: a linked row that landed in
    // another category stays counted there, so it must stay rendered there —
    // hiding it would advertise a badge over an empty list.
    const liveRequestIds = new Set((transferRequests ?? []).map((request) => request.id));
    const visibleNotifications = notifications.filter((item) => {
      const requestId = getLinkedRequestId(item);
      return !requestId || item.category !== 'pending' || !liveRequestIds.has(requestId);
    });

    const handleTransferSettled = useCallback(
      async (request: PendingTransferRequest, succeeded: boolean) => {
        // Re-read first so the resolved item leaves before the row resurfaces.
        // A failed revalidation must not skip the refresh below — treat it as
        // "request no longer live" so the conservative path (refresh) runs.
        let next: PendingTransferRequest[] | undefined;
        try {
          next = await useHomeStore.getState().settleTransferRequest(request.id, succeeded);
        } catch (error) {
          console.error('[InboxNotificationList] transfer revalidation failed', error);
        }
        // The server settles the linked row (marks it read) as part of the
        // state transition — here only the surrounding chrome refreshes so the
        // badge and the read list pick the settled state up. A terminal
        // FAILURE (expired / resolved by another client) also settles the row
        // server-side, so refresh whenever the request left the live list,
        // not only on success — otherwise the cached row resurfaces unread.
        const stillLive = !!next?.some((item) => item.id === request.id);
        if (succeeded || !stillLive) onRefreshInbox();
      },
      [onRefreshInbox],
    );

    // The VList renders the live transfer items followed by
    // `visibleNotifications`, so the bottom index must be compared against the
    // rendered count — measuring against the unfiltered page length would
    // stall pagination once suppressed rows accumulate.
    const visibleCount = visibleNotifications.length;
    const renderedCount = liveRequests.length + visibleCount;
    const handleScroll = useCallback(() => {
      const ref = virtuaRef.current;
      if (!ref || !hasMore || isLoadingMore || loadMoreError) return;

      const bottomVisibleIndex = ref.findItemIndex(ref.scrollOffset + ref.viewportSize);
      if (bottomVisibleIndex + 5 > renderedCount) loadMore();
    }, [hasMore, isLoadingMore, loadMore, loadMoreError, renderedCount]);

    // When every loaded row is suppressed by a live request there is no VList
    // to scroll, so pagination would never advance — fetch the next page until
    // something renders or the stream ends.
    const allLoadedSuppressed = visibleCount === 0 && notifications.length > 0;
    useEffect(() => {
      if (allLoadedSuppressed && hasMore && !isLoadingMore && !loadMoreError) loadMore();
    }, [allLoadedSuppressed, hasMore, isLoadingMore, loadMore, loadMoreError]);

    // A restored snapshot can be empty or stale: "nothing here" is only said
    // once the server answered (for the stream, and for the live transfers
    // that would render above it).
    const isEmptyConfirmed =
      isFeedConfirmed &&
      (!workspaceId || !showTransfers || isTransfersConfirmed || !!transfersError);

    if (!loadedNotifications && !headError) {
      return (
        <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
          <SkeletonList rows={5} />
        </Flexbox>
      );
    }

    if (headError) {
      return (
        <AsyncError error={headError} retrying={isHeadValidating} variant="page" onRetry={retry} />
      );
    }

    // Rendered INSIDE the VList (not as fixed siblings): the modal caps its
    // height and hides overflow, so cards outside the scroll container would
    // clip once several transfers (with their manifest rows) stack up.
    const transferItems = currentUserId
      ? liveRequests.map((request) => (
          <Flexbox className={stylex.props(styles.item).className} key={request.id}>
            <TransferRequestItem
              currentUserId={currentUserId}
              request={request}
              onSettled={handleTransferSettled}
            />
          </Flexbox>
        ))
      : [];

    if (visibleNotifications.length === 0 && transferItems.length === 0) {
      // A failed read — of a restored snapshot, or a refresh after a settled
      // empty answer — shows with its Retry rather than as "nothing here".
      if (error) {
        return (
          <AsyncError
            error={error}
            retrying={isHeadValidating || isLoadingMore}
            variant="page"
            onRetry={retry}
          />
        );
      }
      if (!isEmptyConfirmed) {
        return (
          <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
            <SkeletonList rows={5} />
          </Flexbox>
        );
      }
      return (
        <Flexbox height="100%">
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
        </Flexbox>
      );
    }

    return (
      <Flexbox height="100%">
        <VList ref={virtuaRef} style={{ flex: 1 }} onScroll={handleScroll}>
          {transferItems.length > 0 && transfersError ? (
            // The cards above stay; their actions wait for a confirmed list.
            <AsyncError
              error={transfersError}
              retrying={isTransfersValidating}
              variant="inline"
              onRetry={() => void retryTransfers()}
            />
          ) : null}
          {transferItems}
          {visibleNotifications.map((item) => (
            <Flexbox className={stylex.props(styles.item).className} key={item.id}>
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
            <AsyncError error={error} retrying={isValidating} variant="inline" onRetry={retry} />
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
