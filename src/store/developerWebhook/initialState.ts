import { type WebhookDeliveryItem, type WebhookEndpointItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface DeveloperWebhookState {
  /** Latest deliveries by endpoint id. Replica view of `deliveryListReplica`. */
  deliveryListMap: Record<string, WebhookDeliveryItem[]>;
  /** Replica bookkeeping for `deliveryListMap`. */
  deliveryListReplica: ReplicaState<WebhookDeliveryItem[]>;
  /** The endpoint list under the `all` key. Replica view of `endpointListReplica`. */
  endpointListMap: Record<string, WebhookEndpointItem[]>;
  /** Replica bookkeeping for `endpointListMap`. */
  endpointListReplica: ReplicaState<WebhookEndpointItem[]>;
}

export const initialDeveloperWebhookState: DeveloperWebhookState = {
  deliveryListMap: {},
  deliveryListReplica: createReplicaState(),
  endpointListMap: {},
  endpointListReplica: createReplicaState(),
};
