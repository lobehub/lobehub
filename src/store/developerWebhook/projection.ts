import { type WebhookDeliveryItem, type WebhookEndpointItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import { developerWebhookService } from '@/services/developerWebhook';

/**
 * The developer webhook endpoints of the active scope (user + workspace), keyed
 * `all`. Persisted so the settings page paints the last-known rows on open; rows
 * never carry the signing secret, only its hint.
 */
export const webhookEndpointListResource = defineReplica<
  Record<string, never>,
  WebhookEndpointItem[]
>({
  fetcher: () => developerWebhookService.list(),
  key: () => 'all',
  name: 'developerWebhookList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One endpoint's latest deliveries, keyed by endpoint id. Memory-only: they are
 * short-lived, change with every attempt, and nobody needs them before the
 * network answers.
 */
export const webhookDeliveryListResource = defineReplica<string, WebhookDeliveryItem[]>({
  fetcher: (endpointId) => developerWebhookService.listDeliveries(endpointId),
  key: (endpointId) => endpointId,
  name: 'developerWebhookDeliveries',
  storage: 'memory',
  version: 1,
});
