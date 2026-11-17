import type {
  WebhookDeliveryEventType,
  WebhookDeliveryStatus,
  WebhookDisabledReason,
  WebhookEventEnvelope,
  WebhookEventType,
} from '@lobechat/types';
import { boolean, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamps, timestamptz } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/** A URL a developer registered to receive outbound events (`/api/v1/webhooks`). */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('webhookEndpoints'))
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description'),
    /** KeyVaults ciphertext of the signing secret; never part of a read shape. */
    secret: text('secret').notNull(),
    /** Last characters of the plaintext secret, shown so the owner can tell secrets apart. */
    secretHint: text('secret_hint').notNull(),
    events: jsonb('events').$type<WebhookEventType[]>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    disabledReason: text('disabled_reason').$type<WebhookDisabledReason>(),
    /** Deliveries that exhausted their retries since the last success. */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastDeliveryAt: timestamptz('last_delivery_at'),
    ...timestamps,
  },
  (t) => [
    index('webhook_endpoints_user_id_idx').on(t.userId),
    index('webhook_endpoints_workspace_id_idx').on(t.workspaceId),
  ],
);

/** One event sent (or to be sent) to one endpoint, with the result of its latest attempt. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('webhookDeliveries'))
      .notNull(),
    endpointId: text('endpoint_id')
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').$type<WebhookDeliveryEventType>().notNull(),
    /** The exact JSON body sent; a redelivery resends it unchanged. */
    payload: jsonb('payload').$type<WebhookEventEnvelope>().notNull(),
    status: text('status').$type<WebhookDeliveryStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    nextAttemptAt: timestamptz('next_attempt_at'),
    deliveredAt: timestamptz('delivered_at'),
    /** The delivery this one resends, for `/deliveries/{id}/redeliver`. */
    redeliveryOf: text('redelivery_of'),
    createdAt: createdAt(),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    index('webhook_deliveries_endpoint_created_idx').on(t.endpointId, t.createdAt),
    index('webhook_deliveries_user_id_idx').on(t.userId),
    index('webhook_deliveries_workspace_id_idx').on(t.workspaceId),
  ],
);

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpointRow = typeof webhookEndpoints.$inferInsert;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveryRow = typeof webhookDeliveries.$inferInsert;
