import { type HomeStore } from '@/store/home/store';

import {
  INBOX_NAVIGATION_COUNTS_KEY,
  type InboxNotificationParams,
  inboxNotificationsKey,
  PENDING_TRANSFER_REQUESTS_KEY,
} from './projection';

/**
 * Whether an entry was answered by the server in this session. A value
 * restored from storage can be an empty, truncated or stale snapshot, so an
 * empty list (or a missing row) only means "nothing there" once this holds.
 * Later local writes keep the flag; an identity switch empties the entries.
 */
const isServerConfirmed = (entry: { source: string } | undefined) => entry?.source === 'server';

/** One inbox view; `undefined` until hydrated or fetched. */
const notificationFeed = (params: InboxNotificationParams) => (s: HomeStore) =>
  s.inboxNotificationsMap[inboxNotificationsKey(params)];

const isNotificationFeedConfirmed = (params: InboxNotificationParams) => (s: HomeStore) =>
  isServerConfirmed(s.inboxNotificationsReplica.entries[inboxNotificationsKey(params)]);

/** Sidebar counts; `undefined` until hydrated or fetched. */
const navigationCounts = (s: HomeStore) => s.inboxNavigationCountsMap[INBOX_NAVIGATION_COUNTS_KEY];

const isNavigationCountsConfirmed = (s: HomeStore) =>
  isServerConfirmed(s.inboxNavigationCountsReplica.entries[INBOX_NAVIGATION_COUNTS_KEY]);

/** Live transfer requests; `undefined` until hydrated or fetched. */
const pendingTransferRequests = (s: HomeStore) =>
  s.pendingTransferRequestsMap[PENDING_TRANSFER_REQUESTS_KEY];

/** A restored request may have been resolved since: act on it only once confirmed. */
const isPendingTransferRequestsConfirmed = (s: HomeStore) =>
  isServerConfirmed(s.pendingTransferRequestsReplica.entries[PENDING_TRANSFER_REQUESTS_KEY]);

const transferManifest = (requestId: string) => (s: HomeStore) => s.transferManifestMap[requestId];

/** A restored manifest paints the summary, but only a fresh one may unlock Accept. */
const isTransferManifestConfirmed = (requestId: string) => (s: HomeStore) =>
  isServerConfirmed(s.transferManifestReplica.entries[requestId]);

export const homeNotificationSelectors = {
  isNavigationCountsConfirmed,
  isNotificationFeedConfirmed,
  isPendingTransferRequestsConfirmed,
  isTransferManifestConfirmed,
  navigationCounts,
  notificationFeed,
  pendingTransferRequests,
  transferManifest,
};
