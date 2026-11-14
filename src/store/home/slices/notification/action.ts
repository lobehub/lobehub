import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { notificationService } from '@/services/notification';
import {
  type PendingTransferRequest,
  resourceTransferRequestService,
  type TransferManifest,
} from '@/services/resourceTransferRequest';
import type { HomeStore } from '@/store/home/store';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  INBOX_NAVIGATION_COUNTS_KEY,
  INBOX_NOTIFICATION_PAGE_SIZE,
  type InboxNavigationCount,
  inboxNavigationCountsResource,
  type InboxNotificationFeed,
  type InboxNotificationItem,
  type InboxNotificationParams,
  inboxNotificationResource,
  inboxNotificationsKey,
  PENDING_TRANSFER_REQUESTS_KEY,
  pendingTransferRequestsResource,
  type TransferManifestParams,
  transferManifestResource,
} from './projection';

const n = setNamespace('homeNotification');

const SINGLETON_PARAMS: Record<string, never> = {};

/**
 * The modal header and the stream both read the live transfer list on open;
 * one request serves both. Writes refresh with `fetch({ fresh: true })`.
 */
const PENDING_TRANSFERS_DEDUPE_INTERVAL = 10_000;

const markRead = (item: InboxNotificationItem): InboxNotificationItem =>
  item.isRead ? item : { ...item, isRead: true };

/** What every view holds once the server archived the whole stream. */
const emptyFeed = (feed: InboxNotificationFeed): InboxNotificationFeed => ({
  ...feed,
  anchorId: undefined,
  currentPage: 0,
  hasMore: false,
  items: [],
  loadMoreError: undefined,
  nextCursor: null,
  pages: undefined,
});

type Setter = StoreSetter<HomeStore>;
export const createHomeNotificationSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new HomeNotificationActionImpl(set, get, _api);

/**
 * The header inbox modal: the notification stream, its sidebar counts and the
 * live transfer requests pinned above the stream. Each is a replica, so
 * reopening the modal after a reload paints the last answer while the server
 * confirms it. The unread badge (`inbox:unreadCount`) is a poll and stays on
 * SWR.
 */
export class HomeNotificationActionImpl {
  readonly #counts;
  readonly #get: () => HomeStore;
  readonly #manifest;
  readonly #notifications;
  readonly #transfers;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#notifications = createReplicaSlice(inboxNotificationResource, {
      actionPrefix: n('notifications'),
      fetcher: async ({ category, isRead }: InboxNotificationParams, cursor?: string) => {
        const items = await notificationService.list({
          category,
          cursor,
          isRead,
          limit: INBOX_NOTIFICATION_PAGE_SIZE,
        });
        // The server pages by row id and reports no cursor: a short page ends the stream.
        return {
          items,
          nextCursor: items.length < INBOX_NOTIFICATION_PAGE_SIZE ? null : items.at(-1)!.id,
        };
      },
      get,
      set,
      stateKey: 'inboxNotificationsReplica',
      view: recordLens<HomeStore, InboxNotificationFeed>('inboxNotificationsMap'),
    });
    this.#counts = createReplicaSlice(inboxNavigationCountsResource, {
      actionPrefix: n('navigationCounts'),
      fetcher: () => notificationService.getNavigationCounts(),
      get,
      set,
      stateKey: 'inboxNavigationCountsReplica',
      view: recordLens<HomeStore, InboxNavigationCount[]>('inboxNavigationCountsMap'),
    });
    this.#transfers = createReplicaSlice(pendingTransferRequestsResource, {
      actionPrefix: n('pendingTransfers'),
      fetcher: () => resourceTransferRequestService.listMine(),
      get,
      set,
      stateKey: 'pendingTransferRequestsReplica',
      view: recordLens<HomeStore, PendingTransferRequest[]>('pendingTransferRequestsMap'),
    });
    this.#manifest = createReplicaSlice(transferManifestResource, {
      actionPrefix: n('transferManifest'),
      fetcher: ({ recipientId, resourceId, resourceType }: TransferManifestParams) =>
        resourceTransferRequestService.getManifest({ recipientId, resourceId, resourceType }),
      get,
      set,
      stateKey: 'transferManifestReplica',
      view: recordLens<HomeStore, TransferManifest>('transferManifestMap'),
    });
  }

  /** Apply a confirmed change to every inbox view, loaded or only persisted. */
  #patchAllFeeds = async (fn: (feed: InboxNotificationFeed) => InboxNotificationFeed) => {
    const keys = Object.keys(this.#get().inboxNotificationsMap);
    this.#notifications.updateMany(keys.map((key) => ({ apply: (feed) => feed && fn(feed), key })));
    await this.#notifications.patchStoredRows((feed) => feed && fn(feed));
  };

  /** Read one view with `homeNotificationSelectors.notificationFeed`. */
  useFetchInboxNotifications = (
    params: InboxNotificationParams,
    enabled = true,
  ): ReplicaSyncResult => this.#notifications.useSync(params, { enabled });

  /** Read with `homeNotificationSelectors.navigationCounts`. */
  useFetchInboxNavigationCounts = (enabled = true): ReplicaSyncResult =>
    this.#counts.useSync(SINGLETON_PARAMS, { enabled, revalidateOnFocus: false });

  /** Workspace-only. Read with `homeNotificationSelectors.pendingTransferRequests`. */
  useFetchPendingTransferRequests = (enabled = true): ReplicaSyncResult =>
    this.#transfers.useSync(SINGLETON_PARAMS, {
      dedupingInterval: PENDING_TRANSFERS_DEDUPE_INTERVAL,
      enabled,
    });

  /** Read with `homeNotificationSelectors.transferManifest(params.requestId)`. */
  useFetchTransferManifest = (params: TransferManifestParams, enabled = true): ReplicaSyncResult =>
    this.#manifest.useSync(params, { enabled, revalidateOnFocus: false });

  loadMoreInboxNotifications = (params: InboxNotificationParams) =>
    this.#notifications.loadMore(inboxNotificationsKey(params), params);

  /** Re-read every mounted inbox view and the sidebar counts. */
  refreshInboxNotifications = async () => {
    await Promise.all([this.#notifications.revalidate(), this.#counts.revalidate()]);
  };

  /**
   * Mark one row read. The view on screen flips it at once (the unread view
   * drops read rows); once the server confirms, every other view and its
   * persisted copy carries the change too, so a reload cannot resurface it as
   * unread. A rejected call rolls the view back and rethrows.
   */
  markInboxNotificationRead = async (id: string, view: InboxNotificationParams) => {
    const apply = (feed: InboxNotificationFeed) => ({
      ...feed,
      items: feed.items.map((item) => (item.id === id ? markRead(item) : item)),
    });
    await this.#notifications.optimistic(inboxNotificationsKey(view), apply, () =>
      notificationService.markAsRead([id]),
    );
    this.#notifications.updateEntity<InboxNotificationItem>(id, markRead);
  };

  /** Archive one row: optimistic on the view, then dropped from every view and from storage. */
  archiveInboxNotification = async (id: string, view: InboxNotificationParams) => {
    await this.#notifications.optimistic(
      inboxNotificationsKey(view),
      (feed) => ({ ...feed, items: feed.items.filter((item) => item.id !== id) }),
      () => notificationService.archive(id),
    );
    this.#notifications.removeEntity(id);
  };

  /**
   * Mark everything read. Pending's count is left alone: it counts live
   * requests that mark-all-as-read cannot resolve, so zeroing it would only
   * bounce back on the refresh.
   */
  markAllInboxNotificationsRead = async (view: InboxNotificationParams) => {
    this.#counts.update(
      INBOX_NAVIGATION_COUNTS_KEY,
      (counts) =>
        counts?.map((item) => (item.category === 'pending' ? item : { ...item, unreadCount: 0 })),
      { persist: false },
    );
    await this.#notifications.optimistic(
      inboxNotificationsKey(view),
      (feed) => ({ ...feed, items: feed.items.map(markRead) }),
      () => notificationService.markAllAsRead(),
    );
    await this.#patchAllFeeds((feed) => ({ ...feed, items: feed.items.map(markRead) }));
  };

  /** Archive everything: the view empties at once, every other view once the server confirms. */
  archiveAllInboxNotifications = async (view: InboxNotificationParams) => {
    await this.#notifications.optimistic(inboxNotificationsKey(view), emptyFeed, () =>
      notificationService.archiveAll(),
    );
    await this.#patchAllFeeds(emptyFeed);
  };

  /**
   * After a transfer action: a resolved request leaves the list (and storage)
   * before the re-read, so a failed re-read cannot keep its action buttons
   * alive or restore it on the next launch. Resolves the server's live list.
   */
  settleTransferRequest = async (
    requestId: string,
    succeeded: boolean,
  ): Promise<PendingTransferRequest[]> => {
    if (succeeded) {
      this.#transfers.update(PENDING_TRANSFER_REQUESTS_KEY, (list) =>
        list?.filter((request) => request.id !== requestId),
      );
      this.#manifest.remove(requestId);
    }
    const { data } = await this.#transfers.fetch(SINGLETON_PARAMS, { fresh: true });
    return data;
  };
}

export type HomeNotificationAction = Pick<
  HomeNotificationActionImpl,
  keyof HomeNotificationActionImpl
>;
