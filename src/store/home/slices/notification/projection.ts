import { definePagedReplica, defineReplica, type ReplicaPagedData } from '@/libs/replica';
import type { notificationService } from '@/services/notification';
import type {
  PendingTransferRequest,
  TransferManifest,
  TransferRequestResourceType,
} from '@/services/resourceTransferRequest';

/** Server page size of the inbox stream (`notification.list` caps `limit` at 50). */
export const INBOX_NOTIFICATION_PAGE_SIZE = 20;

export type InboxNotificationItem = Awaited<ReturnType<typeof notificationService.list>>[number];

export interface InboxNavigationCount {
  category: string;
  readCount: number;
  totalCount: number;
  unreadCount: number;
}

/**
 * One inbox view: a category (or every category) under a read-state filter
 * (`undefined` = the combined "all" view). The active workspace is part of the
 * replica scope — the server scopes the inbox to the request context — so it is
 * not repeated here.
 */
export interface InboxNotificationParams {
  category?: string;
  isRead?: boolean;
}

export type InboxNotificationFeed = ReplicaPagedData<InboxNotificationItem, string>;

export const inboxNotificationsKey = ({ category, isRead }: InboxNotificationParams) =>
  `${category ?? '*'}:${isRead === undefined ? 'all' : isRead ? 'read' : 'unread'}`;

/**
 * The inbox stream, one entry per view. Only the head page survives a reload,
 * and the views are bounded (categories × read states), with a cap for the
 * extra categories the server may report.
 */
export const inboxNotificationResource = definePagedReplica<
  InboxNotificationParams,
  InboxNotificationItem,
  string
>({
  key: inboxNotificationsKey,
  name: 'inboxNotifications',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'cursor',
    persist: { pages: 1 },
  },
  persist: { maxEntries: 30 },
  storage: 'indexedDB',
  version: 1,
});

/** The inbox sidebar counts are one entry per scope. */
export const INBOX_NAVIGATION_COUNTS_KEY = 'counts';

/** Per-category read / unread / total counts: a handful of numbers. */
export const inboxNavigationCountsResource = defineReplica<
  Record<string, never>,
  InboxNavigationCount[]
>({
  key: () => INBOX_NAVIGATION_COUNTS_KEY,
  name: 'inboxNavigationCounts',
  storage: 'localStorage',
  version: 1,
});

/** The caller's live transfer requests are one entry per scope (workspace only). */
export const PENDING_TRANSFER_REQUESTS_KEY = 'mine';

/** Live transfer requests where the caller is recipient or initiator (server-capped list). */
export const pendingTransferRequestsResource = defineReplica<
  Record<string, never>,
  PendingTransferRequest[]
>({
  key: () => PENDING_TRANSFER_REQUESTS_KEY,
  name: 'pendingTransferRequests',
  storage: 'indexedDB',
  version: 1,
});

export interface TransferManifestParams {
  recipientId: string;
  /** Entry identity only: a request's manifest never moves to another request. */
  requestId: string;
  resourceId: string;
  resourceType: TransferRequestResourceType;
}

/**
 * Impact summary of one live transfer request, keyed by request. A few numbers
 * per request; the cap keeps resolved requests from accumulating.
 */
export const transferManifestResource = defineReplica<TransferManifestParams, TransferManifest>({
  key: ({ requestId }) => requestId,
  name: 'transferManifest',
  persist: { maxEntries: 20 },
  storage: 'localStorage',
  version: 1,
});
