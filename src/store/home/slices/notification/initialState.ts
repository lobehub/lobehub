import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { PendingTransferRequest, TransferManifest } from '@/services/resourceTransferRequest';

import type { InboxNavigationCount, InboxNotificationFeed } from './projection';

export interface HomeNotificationState {
  /** Inbox sidebar counts, the view of the `inboxNavigationCounts` replica. */
  inboxNavigationCountsMap: Record<string, InboxNavigationCount[]>;
  inboxNavigationCountsReplica: ReplicaState<InboxNavigationCount[]>;
  /** Inbox stream per view (`inboxNotificationsKey`), the `inboxNotifications` replica. */
  inboxNotificationsMap: Record<string, InboxNotificationFeed>;
  inboxNotificationsReplica: ReplicaState<InboxNotificationFeed>;
  /** Live transfer requests, the view of the `pendingTransferRequests` replica. */
  pendingTransferRequestsMap: Record<string, PendingTransferRequest[]>;
  pendingTransferRequestsReplica: ReplicaState<PendingTransferRequest[]>;
  /** Impact summary per transfer request id, the `transferManifest` replica. */
  transferManifestMap: Record<string, TransferManifest>;
  transferManifestReplica: ReplicaState<TransferManifest>;
}

export const initialHomeNotificationState: HomeNotificationState = {
  inboxNavigationCountsMap: {},
  inboxNavigationCountsReplica: createReplicaState(),
  inboxNotificationsMap: {},
  inboxNotificationsReplica: createReplicaState(),
  pendingTransferRequestsMap: {},
  pendingTransferRequestsReplica: createReplicaState(),
  transferManifestMap: {},
  transferManifestReplica: createReplicaState(),
};
